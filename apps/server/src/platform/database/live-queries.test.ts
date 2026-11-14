/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies live read convergence, race handling and scoped reader cleanup.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns typed revision observation and lifetime checks.                                   │
 * │ - Preserves failures, successful snapshots and subscriber resource ownership.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real temporary SQLite connections exercise reactive reads without a mocked database.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Deferred, Effect, Fiber, Layer, Result, Stream } from 'effect';
import { expect } from 'vite-plus/test';

import { ServerContext } from './context.ts';
import { Database } from './database.ts';
import { LiveQueries, liveQueriesLayer } from './live-queries.ts';

for (const hinted of [true, false]) {
  testStable(
    `live snapshots converge after ${hinted ? 'hinted' : 'missed-hint'} writes`,
    async () => {
      const fixture = await createTestDatabase();
      const reader = new ServerContext(await fixture.open());
      const writer = hinted ? reader : new ServerContext(await fixture.open());

      try {
        const result = await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const live = yield* LiveQueries;
              const initial = yield* Deferred.make<void>();
              const fiber = yield* live
                .watch(
                  ['settings'],
                  Effect.sync(
                    () =>
                      reader.db.orm.get<{ n: bigint }>(
                        sql`SELECT count(*) AS n FROM preferences WHERE scope = 'test'`
                      )?.n
                  )
                )
                .pipe(
                  Stream.filter((frame) => frame._tag === 'Snapshot'),
                  Stream.map((frame) => Result.getOrThrow(frame.result)),
                  Stream.tap(() => Deferred.succeed(initial, undefined)),
                  Stream.take(2),
                  Stream.runCollect,
                  Effect.forkChild
                );

              yield* Deferred.await(initial);
              writer.transaction(['settings'], (tx) =>
                tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'key', '1')`)
              );

              return yield* Fiber.join(fiber);
            })
          ).pipe(
            Effect.provide(
              liveQueriesLayer({ reconciliationMs: 20 }).pipe(
                Layer.provide(Layer.succeed(Database, { store: reader }))
              )
            ),
            Effect.timeout('3 seconds')
          )
        );

        expect(result).toEqual([0n, 1n]);
      } finally {
        if (writer !== reader) writer.close();

        reader.close();
        await fixture.cleanup();
      }
    }
  );
}

testStable('a write racing a composed snapshot cannot publish mixed committed state', async () => {
  const fixture = await createTestDatabase();
  const reader = new ServerContext(await fixture.open());
  const writer = new ServerContext(await fixture.open());

  try {
    let first = true;
    const read = Effect.gen(function* () {
      const before = reader.revisions().scopes.settings;

      if (first) {
        first = false;
        writer.transaction(['settings'], (tx) =>
          tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'key', '1')`)
        );
        yield* Effect.yieldNow;
      }

      return [before ?? 0n, reader.revisions().scopes.settings ?? 0n];
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const live = yield* LiveQueries;

        return yield* live.watch(['settings'], read).pipe(
          Stream.filter((frame) => frame._tag === 'Snapshot'),
          Stream.map((frame) => Result.getOrThrow(frame.result)),
          Stream.take(1),
          Stream.runCollect
        );
      }).pipe(
        Effect.provide(
          liveQueriesLayer({ reconciliationMs: 20 }).pipe(
            Layer.provide(Layer.succeed(Database, { store: reader }))
          )
        ),
        Effect.timeout('3 seconds')
      )
    );

    expect(result).toEqual([[1n, 1n]]);
  } finally {
    writer.close();
    reader.close();
    await fixture.cleanup();
  }
});

testStable('releasing a live reader interrupts its in-flight read', async () => {
  const fixture = await createTestDatabase();
  const reader = new ServerContext(await fixture.open());

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const live = yield* LiveQueries;
          const started = yield* Deferred.make<void>();
          const stopped = yield* Deferred.make<void>();
          const read = Effect.andThen(Deferred.succeed(started, undefined), Effect.never).pipe(
            Effect.ensuring(Deferred.succeed(stopped, undefined))
          );
          const fiber = yield* live
            .watch(['settings'], read)
            .pipe(Stream.runDrain, Effect.forkChild);

          yield* Deferred.await(started);
          yield* Fiber.interrupt(fiber);
          yield* Deferred.await(stopped);
        })
      ).pipe(
        Effect.provide(
          liveQueriesLayer({ reconciliationMs: 20 }).pipe(
            Layer.provide(Layer.succeed(Database, { store: reader }))
          )
        ),
        Effect.timeout('3 seconds')
      )
    );
  } finally {
    reader.close();
    await fixture.cleanup();
  }
});

testStable(
  'domain failure remains observed and recovers on a later committed dependency change',
  async () => {
    const fixture = await createTestDatabase();
    const reader = new ServerContext(await fixture.open());
    let available = false;

    try {
      const snapshots = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const live = yield* LiveQueries;
            const failed = yield* Deferred.make<void>();
            const fiber = yield* live
              .watch(
                ['settings'],
                Effect.suspend(() =>
                  available ? Effect.succeed('available') : Effect.fail('not_found')
                )
              )
              .pipe(
                Stream.filter((frame) => frame._tag === 'Snapshot'),
                Stream.tap(() => Deferred.succeed(failed, undefined)),
                Stream.take(2),
                Stream.runCollect,
                Effect.forkChild
              );

            yield* Deferred.await(failed);
            available = true;
            reader.transaction(['settings'], (tx) =>
              tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'key', '1')`)
            );

            return yield* Fiber.join(fiber);
          })
        ).pipe(
          Effect.provide(
            liveQueriesLayer({ reconciliationMs: 20 }).pipe(
              Layer.provide(Layer.succeed(Database, { store: reader }))
            )
          ),
          Effect.timeout('3 seconds')
        )
      );

      expect(snapshots.map((frame) => frame.result)).toEqual([
        Result.fail('not_found'),
        Result.succeed('available')
      ]);
    } finally {
      reader.close();
      await fixture.cleanup();
    }
  }
);

testStable('shared heartbeat keeps idle streams alive without rereading snapshots', async () => {
  const fixture = await createTestDatabase();
  const reader = new ServerContext(await fixture.open());
  let reads = 0;

  try {
    const frames = await Effect.runPromise(
      Effect.gen(function* () {
        const live = yield* LiveQueries;

        return yield* live
          .watch(
            ['settings'],
            Effect.sync(() => ++reads)
          )
          .pipe(
            Stream.filter((frame) => frame._tag !== 'Refreshing'),
            Stream.take(3),
            Stream.runCollect
          );
      }).pipe(
        Effect.provide(
          liveQueriesLayer({ reconciliationMs: 10, heartbeatMs: 20 }).pipe(
            Layer.provide(Layer.succeed(Database, { store: reader }))
          )
        ),
        Effect.timeout('3 seconds')
      )
    );

    expect(frames.map((frame) => frame._tag)).toEqual(['Snapshot', 'Heartbeat', 'Heartbeat']);
    expect(reads).toBe(1);
  } finally {
    reader.close();
    await fixture.cleanup();
  }
});

testStable(
  'a failed revision read emits a transient snapshot and a fresh subscription can recover',
  async () => {
    const fixture = await createTestDatabase();
    const reader = new ServerContext(await fixture.open());

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const live = yield* LiveQueries;
            const original = reader.revisions.bind(reader);

            let firstRead = true;
            const read = Effect.sync(() => {
              if (firstRead) {
                firstRead = false;
                reader.revisions = () => {
                  reader.revisions = original;

                  throw new Error('Temporary SQLite failure');
                };
              }

              return 7;
            });
            const failed = yield* live.watch(['settings'], read).pipe(
              Stream.filter((frame) => frame._tag === 'Snapshot'),
              Stream.take(1),
              Stream.runCollect
            );

            expect(failed[0]?.result).toMatchObject({
              _tag: 'Failure',
              failure: { kind: 'transient' }
            });
            const recovered = yield* live.watch(['settings'], Effect.succeed(7)).pipe(
              Stream.filter((frame) => frame._tag === 'Snapshot'),
              Stream.take(1),
              Stream.runCollect
            );

            expect(recovered[0]?.result).toEqual(Result.succeed(7));
          })
        ).pipe(
          Effect.provide(
            liveQueriesLayer({ reconciliationMs: 20 }).pipe(
              Layer.provide(Layer.succeed(Database, { store: reader }))
            )
          ),
          Effect.timeout('3 seconds')
        )
      );
    } finally {
      reader.close();
      await fixture.cleanup();
    }
  }
);

testStable('slow refreshes announce waiting before the next authoritative snapshot', async () => {
  const fixture = await createTestDatabase();
  const reader = new ServerContext(await fixture.open());
  let reads = 0;

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const live = yield* LiveQueries;
          const initial = yield* Deferred.make<void>();
          const refreshing = yield* Deferred.make<void>();
          const finish = yield* Deferred.make<void>();
          const frames: string[] = [];
          const read = Effect.suspend(() =>
            ++reads === 1 ? Effect.succeed(1) : Effect.as(Deferred.await(finish), 2)
          );
          const fiber = yield* live.watch(['settings'], read).pipe(
            Stream.tap((frame) => {
              frames.push(frame._tag);

              if (frame._tag === 'Snapshot') return Deferred.succeed(initial, undefined);

              if (frame._tag === 'Refreshing' && frames.includes('Snapshot'))
                return Deferred.succeed(refreshing, undefined);

              return Effect.void;
            }),
            Stream.filter((frame) => frame._tag === 'Snapshot'),
            Stream.take(2),
            Stream.runCollect,
            Effect.forkChild
          );

          yield* Deferred.await(initial);
          reader.transaction(['settings'], (tx) =>
            tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'key', '1')`)
          );
          yield* Deferred.await(refreshing);
          expect(frames.at(-1)).toBe('Refreshing');
          yield* Deferred.succeed(finish, undefined);
          const snapshots = yield* Fiber.join(fiber);

          expect(snapshots.map((frame) => Result.getOrThrow(frame.result))).toEqual([1, 2]);
          expect(frames).toEqual(['Refreshing', 'Snapshot', 'Refreshing', 'Snapshot']);
        })
      ).pipe(
        Effect.provide(
          liveQueriesLayer({ reconciliationMs: 20 }).pipe(
            Layer.provide(Layer.succeed(Database, { store: reader }))
          )
        ),
        Effect.timeout('3 seconds')
      )
    );
  } finally {
    reader.close();
    await fixture.cleanup();
  }
});

testStable(
  'the shared reconciler recovers a failed tick and still notices a missed hint',
  async () => {
    const fixture = await createTestDatabase();
    const reader = new ServerContext(await fixture.open());
    const writer = new ServerContext(await fixture.open());

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const live = yield* LiveQueries;
            const initial = yield* Deferred.make<void>();
            const fiber = yield* live
              .watch(
                ['settings'],
                Effect.sync(
                  () =>
                    reader.db.orm.get<{ n: bigint }>(
                      sql`SELECT count(*) AS n FROM preferences WHERE scope='test'`
                    )?.n
                )
              )
              .pipe(
                Stream.filter((frame) => frame._tag === 'Snapshot'),
                Stream.tap(() => Deferred.succeed(initial, undefined)),
                Stream.take(2),
                Stream.runCollect,
                Effect.forkChild
              );

            yield* Deferred.await(initial);
            const original = reader.revisions.bind(reader);

            reader.revisions = () => {
              reader.revisions = original;

              throw new Error('One failed reconciliation tick');
            };
            writer.transaction(['settings'], (tx) =>
              tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'key', '1')`)
            );
            const snapshots = yield* Fiber.join(fiber);

            expect(snapshots.map((frame) => Result.getOrThrow(frame.result))).toEqual([0n, 1n]);
          })
        ).pipe(
          Effect.provide(
            liveQueriesLayer({ reconciliationMs: 20 }).pipe(
              Layer.provide(Layer.succeed(Database, { store: reader }))
            )
          ),
          Effect.timeout('3 seconds')
        )
      );
    } finally {
      writer.close();
      reader.close();
      await fixture.cleanup();
    }
  }
);
