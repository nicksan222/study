import type { agentObservationSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies preview buffering preserves text and observation ordering.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests terminal flushes and bounded pending text between timer ticks.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Exercises the real batching helper with a recording observation sink.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { StudyError } from '@study/contracts';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { batchAgentProgress } from '#server/platform/ai/progress';

type Event = (typeof agentObservationSchema.Type)['event'];

test.stable.each<Event>([
  { type: 'tool-start', toolCallId: 'call', toolName: 'sources' },
  { type: 'tool-finish', toolCallId: 'call', toolName: 'sources', outcome: 'success' },
  { type: 'complete' },
  { type: 'failed', kind: 'cancelled' },
  { type: 'failed', kind: 'transient' }
])('flushes pending text before %j', async (event) => {
  const written: Event[] = [];
  const progress = batchAgentProgress((value) =>
    Effect.sync(() => {
      written.push(value);
    })
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* progress.observe({ type: 'text-delta', text: 'first' });
      yield* progress.observe({ type: 'text-delta', text: 'pending' });
      test.expect(written).toEqual([{ type: 'text-delta', text: 'first' }]);
      yield* progress.observe(event);
      yield* progress.flush;
    })
  );

  test
    .expect(written)
    .toEqual([
      { type: 'text-delta', text: 'first' },
      { type: 'text-delta', text: 'pending' },
      event
    ]);
});

test.stable('flushes large pending text without waiting for the timer', async () => {
  const written: string[] = [];
  const progress = batchAgentProgress((event) =>
    Effect.sync(() => {
      if (event.type === 'text-delta') written.push(event.text);
    })
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* progress.observe({ type: 'text-delta', text: 'first' });

      for (let i = 0; i < 8; i++)
        yield* progress.observe({ type: 'text-delta', text: 'x'.repeat(1024) });
    })
  );

  test.expect(written).toEqual(['first', 'x'.repeat(4096), 'x'.repeat(4096)]);
});

test.stable('a failed write cannot leak abandoned text into a later attempt', async () => {
  const written: Event[] = [];
  let reject = true;
  const progress = batchAgentProgress((event) =>
    Effect.suspend(() => {
      if (reject) {
        reject = false;

        return Effect.fail(new StudyError('transient', 'Preview unavailable'));
      }

      written.push(event);

      return Effect.void;
    })
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.flip(progress.observe({ type: 'text-delta', text: 'abandoned' }));
      yield* progress.observe({ type: 'text-delta', text: 'replacement' });
      yield* progress.observe({ type: 'complete' });
    })
  );

  test.expect(written).toEqual([{ type: 'text-delta', text: 'replacement' }, { type: 'complete' }]);
});

test.stable(
  'durable progress commits outside the provider permit owner before acknowledging delivery',
  async () => {
    const { Context } = await import('effect');
    const { Db, sql } = await import('@study/db');
    const { scopedAgentProgress } = await import('#server/platform/ai/progress');
    const ProviderPermit = Context.Reference<boolean>('test/ProviderPermit', {
      defaultValue: () => false
    });
    const db = await Db.open(':memory:');

    try {
      db.exec('CREATE TABLE progress_probe(event TEXT NOT NULL)');
      const write = (event: Event) =>
        Effect.gen(function* () {
          test.expect(yield* ProviderPermit).toBe(false);
          db.transaction((tx) =>
            tx.orm.run(sql`INSERT INTO progress_probe(event) VALUES(${event.type})`)
          );
        });

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const progress = yield* scopedAgentProgress(write);

            yield* progress
              .observe({ type: 'start' })
              .pipe(Effect.provideService(ProviderPermit, true));
            test
              .expect(db.orm.all(sql`SELECT event FROM progress_probe`))
              .toEqual([{ event: 'start' }]);
            yield* progress
              .observe({ type: 'complete' })
              .pipe(Effect.provideService(ProviderPermit, true));
            test
              .expect(db.orm.all(sql`SELECT event FROM progress_probe`))
              .toEqual([{ event: 'start' }, { event: 'complete' }]);
          })
        )
      );
    } finally {
      db.close();
    }
  }
);
