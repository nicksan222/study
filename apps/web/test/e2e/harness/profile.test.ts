import { testStable } from '@study/testing/vitest';
import { Clock, Effect, Fiber } from 'effect';
import { expect } from 'vite-plus/test';

import { captureProfile, captureTimestampClock } from './profile.ts';

testStable('canonical wall time keeps real monotonic time, sleeps and cancellation', async () => {
  const clock = captureTimestampClock();
  const before = clock.monotonicTimeNanosUnsafe();
  const hostBefore = Date.now();

  await Effect.runPromise(
    Effect.sleep('20 millis').pipe(Effect.provideService(Clock.Clock, clock))
  );
  expect(clock.currentTimeMillisUnsafe()).toBe(Date.parse(captureProfile.wallTime));
  expect(await Effect.runPromise(clock.currentTimeMillis)).toBe(
    Date.parse(captureProfile.wallTime)
  );
  expect(await Effect.runPromise(clock.currentTimeNanos)).toBe(clock.currentTimeNanosUnsafe());
  expect(clock.monotonicTimeNanosUnsafe()).toBeGreaterThan(before);
  expect(Date.now()).toBeGreaterThan(hostBefore);
  await Effect.runPromise(
    Effect.gen(function* () {
      const sleeping = yield* Effect.forkChild(Effect.sleep('1 hour'));

      yield* Fiber.interrupt(sleeping);
    }).pipe(Effect.provideService(Clock.Clock, clock))
  );
});
