import { Clock, Context, Effect } from 'effect';

/** Canonical wall time is shared by browser presentation and committed store timestamps. */
export const captureProfile = {
  wallTime: '2026-11-13T11:00:00.000Z',
  focus: 'blur-passive-notebook-entry'
} as const;

export function captureTimestampClock(): Clock.Clock {
  const live = Context.get(Context.empty(), Clock.Clock);
  const millis = Date.parse(captureProfile.wallTime);
  const nanos = BigInt(millis) * 1_000_000n;

  return {
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: live.monotonicTimeNanos,
    sleep: (duration) => live.sleep(duration),
    currentTimeMillisUnsafe: () => millis,
    currentTimeMillis: Effect.succeed(millis),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.succeed(nanos)
  };
}
