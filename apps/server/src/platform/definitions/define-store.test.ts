import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StudyError } from '@study/contracts/errors';
import type { SourceId } from '@study/contracts/ids';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Schema } from 'effect';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  defineStore,
  storeMutation,
  storeQuery,
  transaction,
  useStore
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
    await Effect.runPromise(
      transaction((tx) => tx.store(bound).save('first')).pipe(
        Effect.provideService(Database, { store: a })
      )
    );
    await Effect.runPromise(
      transaction((tx) => tx.store(bound).save('second')).pipe(
        Effect.provideService(Database, { store: b })
      )
    );
    assert.equal(
      await Effect.runPromise(
        Effect.runSync(useStore(bound).pipe(Effect.provideService(Database, { store: a }))).value(
          'key'
        )
      ),
      'first'
    );
    assert.equal(
      await Effect.runPromise(
        Effect.runSync(useStore(bound).pipe(Effect.provideService(Database, { store: b }))).value(
          'key'
        )
      ),
      'second'
    );
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
    assert.equal(
      await Effect.runPromise(
        Effect.runSync(
          useStore(items).pipe(Effect.provideService(Database, { store: context }))
        ).item(3)
      ),
      3
    );
    let leaked: { insert(value: string): string } | undefined;

    assert.equal(
      await Effect.runPromise(
        transaction((tx) => {
          leaked = tx.store(items);

          return leaked.insert('ok');
        }).pipe(Effect.provideService(Database, { store: context }))
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
        transaction((tx) => {
          tx.store(preferences).insert('rolled-back');

          throw new Error('stop');
        }).pipe(Effect.provideService(Database, { store: context }))
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
        Effect.runSync(
          useStore(
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
            })
          ).pipe(Effect.provideService(Database, { store: context }))
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        /must be named item/.test(error.cause.message)
    );
    await assert.rejects(
      Effect.runPromise(
        Effect.runSync(
          useStore(items).pipe(Effect.provideService(Database, { store: context }))
        ).item('bad' as never)
      )
    );
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
        transaction((() => {
          context.db.orm.run(
            sql`INSERT INTO preferences (scope, key, value) VALUES ('test', 'async', 'null')`
          );

          return Promise.resolve('bad');
        }) as never).pipe(Effect.provideService(Database, { store: context }))
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
      Effect.runSync(
        useStore(
          defineStore({
            name: 'test/Bad',
            entity: { singular: 'item', plural: 'items' },

            make: () => ({ queries: { items: { ...op, role: 'other' } as never }, mutations: {} })
          })
        ).pipe(Effect.provideService(Database, { store: context }))
      )
    );
    assert.throws(() =>
      Effect.runSync(
        useStore(
          defineStore({
            name: 'test/Bad',
            entity: { singular: 'item', plural: 'items' },

            make: () => ({
              queries: { item: op },
              mutations: {
                item: storeMutation({
                  input: Schema.Number,
                  output: Schema.Number,
                  run: (id) => id
                })
              }
            })
          })
        ).pipe(Effect.provideService(Database, { store: context }))
      )
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
      Effect.runPromise(
        transaction((tx) => tx.store(store).insert('bad')).pipe(
          Effect.provideService(Database, { store: context })
        )
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

function transactionTypeAssertions(context: ServerContext) {
  // @ts-expect-error transaction callbacks cannot return a Promise
  transaction(() => Promise.resolve(1)).pipe(Effect.provideService(Database, { store: context }));
  // @ts-expect-error transaction callbacks cannot return an Effect
  transaction(() => Effect.succeed(1)).pipe(Effect.provideService(Database, { store: context }));
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
      transaction((tx) => tx.store(items).insert('secret input'))
        .pipe(Effect.provideService(Database, { store: context }))
        .pipe(
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
    await assert.rejects(
      Effect.runPromise(
        Effect.runSync(
          useStore(store).pipe(Effect.provideService(Database, { store: context }))
        ).items({ limit: 1 })
      )
    );
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
    assert.deepEqual(
      await Effect.runPromise(
        Effect.runSync(
          useStore(store).pipe(Effect.provideService(Database, { store: context }))
        ).items({ limit: 1 })
      ),
      result
    );

    for (const value of [[1, 2], { items: [1, 2], nextCursor: null }, { items: [1] }]) {
      result = value;
      await assert.rejects(
        Effect.runPromise(
          Effect.runSync(
            useStore(store).pipe(Effect.provideService(Database, { store: context }))
          ).items({ limit: 1 })
        )
      );
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
    const read: Effect.Effect<number, StudyError> = Effect.runSync(
      useStore(missing).pipe(Effect.provideService(Database, { store: context }))
    ).item(1);

    assert.equal((await Effect.runPromise(Effect.flip(read))).kind, 'not_found');
  } finally {
    context.close();
    location.cleanup();
  }
});

test('store selection resolves Database only at execution and exposes only reads', async () => {
  const first = createTestDatabase();
  const second = createTestDatabase();
  const a = new ServerContext(first.open());
  const b = new ServerContext(second.open());
  const read = useStore(items);
  const write = transaction((tx) => tx.store(items).insert('selected'));

  try {
    const left = await Effect.runPromise(read.pipe(Effect.provideService(Database, { store: a })));
    const right = await Effect.runPromise(read.pipe(Effect.provideService(Database, { store: b })));

    assert.equal(await Effect.runPromise(left.item(7)), 7);
    assert.equal(await Effect.runPromise(right.item(9)), 9);
    assert.equal('insert' in left, false);
    assert.equal(
      await Effect.runPromise(write.pipe(Effect.provideService(Database, { store: a }))),
      'selected'
    );
    assert.equal(
      await Effect.runPromise(write.pipe(Effect.provideService(Database, { store: b }))),
      'selected'
    );
    assert.equal('make' in items, false);
    assert.equal('key' in items, false);
    assert.equal('layer' in items, false);
  } finally {
    a.close();
    b.close();
    first.cleanup();
    second.cleanup();
  }
});

test('a reusable read and write effect select each provided SQLite database', async () => {
  const first = createTestDatabase(),
    second = createTestDatabase();
  const a = new ServerContext(first.open()),
    b = new ServerContext(second.open());
  const store = defineStore({
    name: 'test/LazyDatabase',
    entity: { singular: 'value', plural: 'values' },
    make: ({ db }) => ({
      queries: {
        value: storeQuery({
          role: 'required',
          input: Schema.Void,
          output: Schema.String,
          run: () => {
            const row = db.orm.get<{ value: string }>(
              sql`SELECT value FROM preferences WHERE scope='lazy'`
            );

            return row ? JSON.parse(row.value) : undefined;
          }
        })
      },
      mutations: {
        save: storeMutation({
          input: Schema.String,
          output: Schema.Void,
          run: (value) => {
            db.orm.run(
              sql`INSERT INTO preferences(scope,key,value) VALUES('lazy','key',${JSON.stringify(value)})`
            );
          }
        })
      }
    })
  });
  const write = (value: string) => transaction((tx) => tx.store(store).save(value));
  const read = useStore(store).pipe(Effect.flatMap((view) => view.value(undefined)));

  try {
    await Effect.runPromise(write('left').pipe(Effect.provideService(Database, { store: a })));
    await Effect.runPromise(write('right').pipe(Effect.provideService(Database, { store: b })));
    assert.equal(
      await Effect.runPromise(read.pipe(Effect.provideService(Database, { store: a }))),
      'left'
    );
    assert.equal(
      await Effect.runPromise(read.pipe(Effect.provideService(Database, { store: b }))),
      'right'
    );
  } finally {
    a.close();
    b.close();
    first.cleanup();
    second.cleanup();
  }
});

test('events use the database clock, roll back with state, and reject escaped emitters', async () => {
  const { Clock } = await import('effect');
  const { TestClock } = await import('effect/testing');
  const location = createTestDatabase();

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(123_456);
      const context = new ServerContext(location.open(), yield* Clock.Clock);
      const event = {
        type: 'SourceDeleted' as const,
        eventId: 'outbox-atomic',
        causationId: null,
        correlationId: 'outbox-atomic',
        inputVersion: 1,
        depth: 0,
        sourceId: 1n as SourceId
      };
      let escaped: Transaction | undefined;
      const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
        effect.pipe(Effect.provideService(Database, { store: context }));

      try {
        yield* Effect.flip(
          run(
            transaction((tx) => {
              tx.emit(event);
              context.db.orm.run(
                sql`INSERT INTO preferences(scope,key,value) VALUES('atomic','key','null')`
              );

              throw new Error('rollback');
            })
          )
        );
        assert.equal(
          context.db.orm.get(
            sql`SELECT event_id FROM workflow_events WHERE event_id='outbox-atomic'`
          ),
          undefined
        );
        assert.equal(
          context.db.orm.get(sql`SELECT key FROM preferences WHERE scope='atomic'`),
          undefined
        );
        yield* run(
          transaction((tx) => {
            escaped = tx;
            tx.emit(event);
          })
        );
        assert.equal(
          context.db.orm.get<{ created_at: bigint }>(
            sql`SELECT created_at FROM workflow_events WHERE event_id='outbox-atomic'`
          )?.created_at,
          123_456n
        );
        assert.throws(() => escaped!.emit({ ...event, eventId: 'escaped' }), /no longer active/);
        assert.throws(() => escaped!.store(items), /no longer active/);
      } finally {
        context.close();
      }
    }).pipe(Effect.provide(TestClock.layer()))
  );
  location.cleanup();
});

test('nested transactions use SQLite savepoints and expire only their own operations', async () => {
  const location = createTestDatabase(),
    context = new ServerContext(location.open());
  const store = defineStore({
    name: 'test/Nested',
    entity: { singular: 'item', plural: 'items' },
    make: ({ db }) => ({
      queries: {},
      mutations: {
        save: storeMutation({
          input: Schema.String,
          output: Schema.Void,
          run: (key) => {
            db.orm.run(
              sql`INSERT INTO preferences(scope,key,value) VALUES('nested',${key},'null')`
            );
          }
        })
      }
    })
  });
  const provide = <A, E>(effect: Effect.Effect<A, E, Database>) =>
    effect.pipe(Effect.provideService(Database, { store: context }));
  let inner: { save(key: string): void } | undefined;

  try {
    await Effect.runPromise(
      provide(
        transaction((outer) => {
          const view = outer.store(store);

          view.save('before');
          Effect.runSync(
            Effect.flip(
              provide(
                transaction((tx) => {
                  inner = tx.store(store);
                  inner.save('rolled-back');

                  throw new Error('inner rollback');
                })
              )
            )
          );
          assert.throws(() => inner!.save('escaped'), /no longer active/);
          view.save('after');
        })
      )
    );
    assert.deepEqual(
      context.db.orm
        .all<{ key: string }>(sql`SELECT key FROM preferences WHERE scope='nested' ORDER BY key`)
        .map((row) => row.key),
      ['after', 'before']
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

function canonicalStoreTypeAssertions() {
  const reads: Effect.Effect<
    { item(input: number): Effect.Effect<number, StudyError> },
    StudyError,
    Database
  > = useStore(items);
  const writes: Effect.Effect<string, StudyError, Database> = transaction((tx) =>
    tx.store(items).insert('value')
  );

  void reads;
  void writes;
  // @ts-expect-error Database remains required at execution.
  const missingDatabase: Effect.Effect<string, StudyError> = transaction((tx) =>
    tx.store(items).insert('value')
  );

  void missingDatabase;
  useStore(items).pipe(
    Effect.map((view) => {
      // @ts-expect-error Read views never expose mutations.
      view.insert('value');
    })
  );
  // @ts-expect-error Public store construction is private.
  void items.make;
  // @ts-expect-error Store service keys are private.
  void items.key;
  // @ts-expect-error Store layers are private.
  void items.layer;
  defineStore({
    name: 'test/BrandedQuery',
    entity: { singular: 'item', plural: 'items' },
    make: () => ({
      queries: {
        // @ts-expect-error Mutations cannot be used as queries.
        item: storeMutation({ input: Schema.Number, output: Schema.Number, run: (n) => n })
      },
      mutations: {}
    })
  });
  defineStore({
    name: 'test/BrandedMutation',
    entity: { singular: 'item', plural: 'items' },
    make: () => ({
      queries: {},
      mutations: {
        // @ts-expect-error Queries cannot be used as mutations.
        item: storeQuery({
          role: 'required',
          input: Schema.Number,
          output: Schema.Number,
          run: (n) => n
        })
      }
    })
  });
}

void canonicalStoreTypeAssertions;

test('unbranded and role-swapped operation descriptors fail at binding', async () => {
  const location = createTestDatabase(),
    context = new ServerContext(location.open());
  const query = storeQuery({
    role: 'required',
    input: Schema.Number,
    output: Schema.Number,
    run: (n) => n
  });
  const mutation = storeMutation({ input: Schema.Number, output: Schema.Number, run: (n) => n });

  try {
    for (const definitions of [
      { queries: { item: mutation }, mutations: {} },
      { queries: {}, mutations: { save: query } },
      {
        queries: {
          item: {
            role: 'required',
            input: Schema.Number,
            output: Schema.Number,
            run: (n: number) => n
          }
        },
        mutations: {}
      },
      {
        queries: {},
        mutations: { save: { input: Schema.Number, output: Schema.Number, run: (n: number) => n } }
      }
    ]) {
      const invalid = defineStore({
        name: 'test/InvalidBrand',
        entity: { singular: 'item', plural: 'items' },
        make: () => definitions as never
      });
      const error = await Effect.runPromise(
        useStore(invalid).pipe(Effect.provideService(Database, { store: context }), Effect.flip)
      );

      assert.equal(error.kind, 'internal');
      assert.match(String(error.cause), /require store(Query|Mutation) descriptors/);
    }
  } finally {
    context.close();
    location.cleanup();
  }
});

test('async callbacks are rejected before their continuation can escape the transaction', async () => {
  const location = createTestDatabase(),
    context = new ServerContext(location.open());
  let entered = false;

  try {
    await assert.rejects(
      Effect.runPromise(
        transaction((async () => {
          entered = true;
          await Promise.resolve();
          context.db.orm.run(
            sql`INSERT INTO preferences(scope,key,value) VALUES('escaped-async','key','null')`
          );

          return 'invalid';
        }) as never).pipe(Effect.provideService(Database, { store: context }))
      )
    );
    await Promise.resolve();
    assert.equal(entered, false);
    assert.equal(
      context.db.orm.get(sql`SELECT key FROM preferences WHERE scope='escaped-async'`),
      undefined
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
