import { forwardAbort, sendFrames, frameSize } from '@study/client/pairing';
import type { MobileRoom } from '@study/client/pairing';

/** One scoped native RPC stream over the authenticated WebRTC peer. */
export async function openPeerRpc(
  link: MobileRoom,
  peer: string,
  request: AbortSignal,
  lifetime: AbortSignal
) {
  request.throwIfAborted();
  lifetime.throwIfAborted();
  const id = crypto.randomUUID();
  const closed = new AbortController();
  const cancel = new AbortController();
  const { signal } = cancel;
  const listeners: Array<() => void> = [];
  let readableController!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      readableController = controller;
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
          if (peerId === peer && channel === id && release())
            controller.error(new Error('Desktop RPC connection closed'));
        }),
        link.room.onPeerLeave(({ peerId }) => {
          if (peerId === peer && release()) controller.error(new Error('Desktop disconnected'));
        })
      );
    },
    cancel() {
      close();
    }
  });
  const writable = new WritableStream<Uint8Array>({
    write(data) {
      closed.signal.throwIfAborted();

      return sendFrames(link.up, data, peer, id, closed.signal);
    },
    close() {
      if (close()) readableController.close();
    },
    abort: fail
  });

  function release() {
    if (closed.signal.aborted) return false;

    closed.abort();
    signal.removeEventListener('abort', onAbort);

    for (const stop of listeners) stop();

    return true;
  }

  function close() {
    if (!release()) return false;

    void link.close.send(id, { target: peer }).catch(() => undefined);

    return true;
  }

  function fail(reason: unknown) {
    if (close()) readableController.error(reason);
  }

  function onAbort() {
    fail(signal.reason);
  }

  signal.addEventListener('abort', onAbort, { once: true });
  listeners.push(forwardAbort(request, cancel), forwardAbort(lifetime, cancel));

  try {
    const approved = await link.open.request(id, { target: peer, timeoutMs: 10_000, signal });

    if (!approved || closed.signal.aborted) throw new Error('Desktop RPC connection unavailable');

    return { readable, writable };
  } catch (error) {
    fail(error);

    throw error;
  }
}
