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

import type { agentObservationSchema } from '@study/contracts/ai/progress';
import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { batchAgentProgress } from '#server/platform/ai/progress';

type Event = (typeof agentObservationSchema.Type)['event'];

testStable.each<Event>([
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
      expect(written).toEqual([{ type: 'text-delta', text: 'first' }]);
      yield* progress.observe(event);
      yield* progress.flush;
    })
  );

  expect(written).toEqual([
    { type: 'text-delta', text: 'first' },
    { type: 'text-delta', text: 'pending' },
    event
  ]);
});

testStable('flushes large pending text without waiting for the timer', async () => {
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

  expect(written).toEqual(['first', 'x'.repeat(4096), 'x'.repeat(4096)]);
});

testStable('a failed write cannot leak abandoned text into a later attempt', async () => {
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

  expect(written).toEqual([{ type: 'text-delta', text: 'replacement' }, { type: 'complete' }]);
});
