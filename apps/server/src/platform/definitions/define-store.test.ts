import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StudyError } from '@study/contracts/errors';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Schema } from 'effect';

import { ServerContext } from '#server/platform/database/context';
import {
  defineStore,
  storeMutation,
  storeQuery,
  transaction
} from '#server/platform/definitions/define-store';

const items = defineStore({
  name: 'test/Items',
  entity: { singular: 'item', plural: 'items' },

  make: ({ db }) => ({
    queries: {
      item: storeQuery({
        input: Schema.Number,
        output: Schema.Number,
        role: 'required',
        run: (id) => Number(db.orm.get<{ n: bigint }>(sql`SELECT ${id} AS n`)!.n)
      })
    },
    mutations: {
      insert: storeMutation({
        input: Schema.String,
        output: Schema.String,
        run: (value) => value
      })
    }
  })
});

test('a store binds resources once per application without sharing database handles', async () => {
  const first = createTestDatabase();
  const second = createTestDatabase();
  const a = new ServerContext(first.open());
  const b = new ServerContext(second.open());
  let bindings = 0;
  const bound = defineStore({
    name: 'test/Bound',
    entity: { singular: 'value', plural: 'values' },
    make: ({ db }) => {
      bindings++;

      return {
        queries: {
          value: storeQuery({
            role: 'required',
            input: Schema.String,
            output: Schema.String,
            run: (key) =>
              JSON.parse(
                db.orm.get<{ value: string }>(
                  sql`SELECT value FROM preferences WHERE scope='bound' AND key=${key}`
                )?.value ?? 'null'
              )
          })
        },
        mutations: {
          save: storeMutation({
            input: Schema.String,
            output: Schema.Void,
            run: (value) => {
              db.orm.run(
                sql`INSERT INTO preferences(scope,key,value) VALUES('bound','key',${JSON.stringify(value)})`
              );
            }
          })
        }
      };
    }
  });

  try {
    await Effect.runPromise(transaction(a, (tx) => tx.store(bound).save('first')));
    await Effect.runPromise(transaction(b, (tx) => tx.store(bound).save('second')));
    assert.equal(await Effect.runPromise(bound.make(a).value('key')), 'first');
    assert.equal(await Effect.runPromise(bound.make(b).value('key')), 'second');
    assert.equal(bindings, 2);
  } finally {
    a.close();
    b.close();
    first.cleanup();
    second.cleanup();
  }
});

test('store runs decoded operations on the real database and rejects leaked transaction views', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    assert.equal(await Effect.runPromise(items.make(context).item(3)), 3);
    let leaked: { insert(value: string): string } | undefined;

    assert.equal(
      await Effect.runPromise(
        transaction(context, (tx) => {
          leaked = tx.store(items);

          return leaked.insert('ok');
        })
      ),
      'ok'
    );
    assert.throws(() => leaked!.insert('later'), /transaction.*active/i);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('transaction rolls back a write when a later step throws', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const preferences = defineStore({
    name: 'test/Preferences',
    entity: { singular: 'preference', plural: 'preferences' },

    make: ({ db }) => ({
      queries: {},
      mutations: {
        insert: storeMutation({
          input: Schema.String,
          output: Schema.String,
          run: (key) => {
            db.orm.run(
              sql`INSERT INTO preferences (scope, key, value) VALUES ('test', ${key}, 'null')`
            );

            return key;
          }
        })
      }
    })
  });

  try {
    await assert.rejects(
      Effect.runPromise(
        transaction(context, (tx) => {
          tx.store(preferences).insert('rolled-back');

          throw new Error('stop');
        })
      )
    );
    assert.equal(
      context.db.orm.get(sql`SELECT key FROM preferences WHERE scope = 'test'`),
      undefined
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('rejects invalid query names and decodes inputs before executing', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    assert.throws(
      () =>
        defineStore({
          name: 'test/Bad',
          entity: { singular: 'item', plural: 'items' },

          make: () => ({
            queries: {
              list: storeQuery({
                input: Schema.Number,
                output: Schema.Number,
                role: 'required',
                run: (id) => id
              })
            },
            mutations: {}
          })
        }).make(context),
      /must be named item/
    );
    await assert.rejects(Effect.runPromise(items.make(context).item('bad' as never)));
  } finally {
    context.close();
    location.cleanup();
  }
});

test('rejects asynchronous transaction results before committing', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    await assert.rejects(
      Effect.runPromise(
        transaction(context, (() => {
          context.db.orm.run(
            sql`INSERT INTO preferences (scope, key, value) VALUES ('test', 'async', 'null')`
          );

          return Promise.resolve('bad');
        }) as never)
      )
    );
    assert.equal(
      context.db.orm.get(sql`SELECT key FROM preferences WHERE scope = 'test'`),
      undefined
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('rejects invalid roles and duplicate operation names', () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    const op = storeQuery({
      input: Schema.Number,
      output: Schema.Number,
      role: 'required',
      run: (id) => id
    });

    assert.throws(() =>
      defineStore({
        name: 'test/Bad',
        entity: { singular: 'item', plural: 'items' },

        make: () => ({ queries: { items: { ...op, role: 'other' } as never }, mutations: {} })
      }).make(context)
    );
    assert.throws(() =>
      defineStore({
        name: 'test/Bad',
        entity: { singular: 'item', plural: 'items' },

        make: () => ({
          queries: { item: op },
          mutations: {
            item: storeMutation({ input: Schema.Number, output: Schema.Number, run: (id) => id })
          }
        })
      }).make(context)
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('rejects asynchronous mutation values even with permissive output and rolls back', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const store = defineStore({
    name: 'test/Async',
    entity: { singular: 'item', plural: 'items' },

    make: ({ db }) => ({
      queries: {},
      mutations: {
        insert: storeMutation({
          input: Schema.String,
          output: Schema.Unknown,
          run: (value) => {
            db.orm.run(
              sql`INSERT INTO preferences (scope, key, value) VALUES ('test', ${value}, 'null')`
            );

            return Promise.resolve(value);
          }
        })
      }
    })
  });

  try {
    await assert.rejects(
      Effect.runPromise(transaction(context, (tx) => tx.store(store).insert('bad')))
    );
    assert.equal(
      context.db.orm.get(sql`SELECT key FROM preferences WHERE scope = 'test'`),
      undefined
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

function transactionTypeAssertions(context: ServerContext) {
  // @ts-expect-error transaction callbacks cannot return a Promise
  transaction(context, () => Promise.resolve(1));
  // @ts-expect-error transaction callbacks cannot return an Effect
  transaction(context, () => Effect.succeed(1));
}

void transactionTypeAssertions;

test('transaction steps inherit the transaction span and emit safe timing', async () => {
  const { Context, Logger, Option, References, Tracer } = await import('effect');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const entries: Array<{ annotations: unknown; span: unknown }> = [];
  const logger = Logger.make((entry) => {
    entries.push({
      annotations: entry.fiber.getRef(References.CurrentLogAnnotations),
      span: Option.map(Context.getOption(entry.fiber.context, Tracer.ParentSpan), (span) =>
        span._tag === 'Span' ? span.name : 'external'
      )
    });
  });

  try {
    await Effect.runPromise(
      transaction(context, (tx) => tx.store(items).insert('secret input')).pipe(
        Effect.annotateLogs({ requestId: 'request', token: 'secret token' }),
        Effect.provide(Logger.layer([logger])),
        Effect.provideService(References.MinimumLogLevel, 'Debug')
      )
    );
    const serialized = JSON.stringify(entries);

    assert.match(serialized, /test\/Items.insert/);
    assert.match(serialized, /durationMs/);
    assert.match(serialized, /request/);
    assert.doesNotMatch(serialized, /secret/);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('collection queries enforce cardinality even with a permissive schema', async () => {
  const store = defineStore({
    name: 'test/Collection',
    entity: { singular: 'item', plural: 'items' },

    make: () => ({
      queries: {
        items: storeQuery({
          role: 'collection',
          input: Schema.Struct({ limit: Schema.Number }),
          output: Schema.Unknown,
          run: () => 'not a collection'
        })
      },
      mutations: {}
    })
  });
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    await assert.rejects(Effect.runPromise(store.make(context).items({ limit: 1 })));
  } finally {
    context.close();
    location.cleanup();
  }
});

test('bounded pages are native query results and oversized arrays or pages are rejected', async () => {
  let result: unknown = { items: [1], next: null };
  const store = defineStore({
    name: 'test/Pages',
    entity: { singular: 'item', plural: 'items' },

    make: () => ({
      queries: {
        items: storeQuery({
          role: 'collection',
          input: Schema.Struct({ limit: Schema.Int }),
          output: Schema.Unknown,
          run: () => result
        })
      },
      mutations: {}
    })
  });
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    assert.deepEqual(await Effect.runPromise(store.make(context).items({ limit: 1 })), result);

    for (const value of [[1, 2], { items: [1, 2], nextCursor: null }, { items: [1] }]) {
      result = value;
      await assert.rejects(Effect.runPromise(store.make(context).items({ limit: 1 })));
    }
  } finally {
    context.close();
    location.cleanup();
  }
});

test('required queries normalize a typed missing row without non-null assertions', async () => {
  const missing = defineStore({
    name: 'test/MissingItem',
    entity: { singular: 'item', plural: 'items' },

    make: ({ db }) => ({
      queries: {
        item: storeQuery({
          role: 'required',
          input: Schema.Number,
          output: Schema.Number,
          run: (id) => {
            const row = db.orm.get<{ n: bigint }>(sql`SELECT ${id} AS n WHERE 0`);

            return row ? Number(row.n) : null;
          }
        })
      },
      mutations: {}
    })
  });
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    const read: Effect.Effect<number, StudyError> = missing.make(context).item(1);

    assert.equal((await Effect.runPromise(Effect.flip(read))).kind, 'not_found');
  } finally {
    context.close();
    location.cleanup();
  }
});
