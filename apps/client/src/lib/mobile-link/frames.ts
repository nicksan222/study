import { frameSize } from './protocol';
import type { MobileRoom } from './room';

/** The native NDJSON decoder accepts partial frames. Bound each data channel message. */
export async function sendFrames(
  action: MobileRoom['up'],
  data: Uint8Array,
  target: string,
  channel: string,
  signal: AbortSignal
) {
  for (let offset = 0; offset < data.byteLength; offset += frameSize) {
    await action.send(data.subarray(offset, offset + frameSize), {
      target,
      metadata: channel,
      signal
    });
  }
}
