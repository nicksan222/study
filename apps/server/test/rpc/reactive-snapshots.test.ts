import { StudyRpc } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authoritative native RPC snapshots and independent concurrent mutation   │
 * │ results.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns typed revision observation and lifetime checks.                                   │
 * │ - Preserves failures, successful snapshots and subscriber resource ownership.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real application services and HTTP transport use isolated temporary SQLite database      │
 * │ files.                                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { plainBlock } from '@study/contracts';
import { pages } from '@study/db';
import { test } from '@study/testing';
import { Deferred, Effect, Fiber, Result, Stream } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { serve } from '#server/runtime/index';

test.server.stable(
  'native live RPC reflects another client mutation and keeps concurrent results separate',
  async ({ resources: fixture, expect }) => {
    const app = await fixture.openApp({ path: fixture.path });
    const server = await serve(app);

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const reader = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const writer = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const ready = yield* Deferred.make<void>();
            const updated = yield* Deferred.make<void>();
            const snapshots = yield* reader['projects.projects.live']({ limit: 10 }).pipe(
              Stream.filter((frame) => frame._tag === 'Snapshot'),
              Stream.map((frame) => Result.getOrThrow(frame.result)),
              Stream.tap((page) =>
                page.items.length === 0
                  ? Deferred.succeed(ready, undefined)
                  : Deferred.succeed(updated, undefined)
              ),
              Stream.takeUntil((page) => page.items.length === 2),
              Stream.runCollect,
              Effect.forkChild
            );

            yield* Deferred.await(ready);
            const results = yield* Effect.all(
              [
                writer['projects.createProject']({ name: 'Biology' }),
                writer['projects.createProject']({ name: 'Chemistry' })
              ],
              { concurrency: 2 }
            );

            expect(results.map((result) => result.name)).toEqual(['Biology', 'Chemistry']);
            expect(results[0]?.id).not.toBe(results[1]?.id);
            yield* Deferred.await(updated);
            const pages = yield* Fiber.join(snapshots);

            expect(
              pages
                .at(-1)
                ?.items.map((project) => project.name)
                .sort()
            ).toEqual(['Biology', 'Chemistry']);
          })
        ).pipe(Effect.timeout('10 seconds'))
      );
    } finally {
      await server.close();
      await app.close();
      await fixture.close();
    }
  }
);

test.server.stable(
  'navigation counts are not capped by mounted windows and exclude unpublished pages',
  async ({ resources: fixture, expect }) => {
    const app = await fixture.openApp({ path: fixture.path });
    const server = await serve(app);

    try {
      app.store.transaction(['pages'], (tx) =>
        tx.db.orm
          .insert(pages)
          .values({ title: 'Pending publication', created_at: 1n, updated_at: 1n })
          .run()
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            expect(yield* client['pages.count']({ archived: false })).toBe(0n);
            yield* client['pages.create']({
              title: 'Published',
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              document: {
                blocks: [plainBlock('paragraph', 'Published body', { type: 'authored' })],
                meta: {
                  extractor: null,
                  extractorVersion: 0,
                  provider: null,
                  durationMs: null,
                  pageCount: null,
                  refiners: [],
                  waitingFor: [],
                  corrected: false,
                  omissions: []
                }
              }
            });
            expect(yield* client['pages.count']({ archived: false })).toBe(1n);
            yield* Effect.forEach(
              Array.from({ length: 101 }, (_, index) => index),
              (index) => client['notes.createNote']({ title: `Notebook ${index}` }),
              { concurrency: 1, discard: true }
            );
            const mounted = yield* client['notes.notes']({ limit: 100 });

            expect(mounted.items).toHaveLength(100);
            expect(mounted.next).not.toBeNull();
            expect(yield* client['notes.count']({})).toBe(101n);
          })
        ).pipe(Effect.timeout('20 seconds'))
      );
    } finally {
      await server.close();
      await app.close();
      await fixture.close();
    }
  }
);
