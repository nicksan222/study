import { sendFrames } from './frames';
import { frameSize } from './protocol';
import type { MobileRoom } from './room';

/** One scoped native RPC stream over the authenticated WebRTC peer. */
export async function openPeerRpc(link: MobileRoom, peer: string, signal: AbortSignal) {
  const id = crypto.randomUUID();
  const closed = new AbortController();
  const listeners: Array<() => void> = [];
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      listeners.push(
        link.down.onMessage((data, { peerId, metadata }) => {
          if (
            peerId === peer &&
            metadata === id &&
            data instanceof Uint8Array &&
            data.byteLength <= frameSize
          )
            controller.enqueue(data);
        }),
        link.close.onMessage((channel, { peerId }) => {
          if (peerId === peer && channel === id) {
            release();
            controller.error(new Error('Desktop RPC connection closed'));
          }
        }),
        link.room.onPeerLeave(({ peerId }) => {
          if (peerId === peer) {
            release();
            controller.error(new Error('Desktop disconnected'));
          }
        })
      );
    },
    cancel() {
      close();
    }
  });
  const writable = new WritableStream<Uint8Array>({
    write(data) {
      return sendFrames(link.up, data, peer, id, closed.signal);
    },
    close,
    abort: close
  });

  function release() {
    if (closed.signal.aborted) return;

    closed.abort();

    for (const stop of listeners) stop();
  }

  function close() {
    if (closed.signal.aborted) return;

    release();
    void link.close.send(id, { target: peer }).catch(() => undefined);
  }

  try {
    const approved = await link.open.request(id, { target: peer, timeoutMs: 10_000, signal });

    if (!approved || closed.signal.aborted) throw new Error('Desktop RPC connection unavailable');

    return { readable, writable };
  } catch (error) {
    close();

    throw error;
  }
}
