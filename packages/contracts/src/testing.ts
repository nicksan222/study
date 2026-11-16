import { Effect, Stream } from 'effect';

import type { LiveFrame } from './protocol.ts';

/** Unwrap authoritative snapshots while retaining typed stream and application failures. */
export function snapshotValues<A, E, F, R>(frames: Stream.Stream<LiveFrame<A, E>, F, R>) {
  return frames.pipe(
    Stream.filter((frame) => frame._tag === 'Snapshot'),
    Stream.mapEffect((frame) => Effect.fromResult(frame.result))
  );
}
