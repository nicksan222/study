import { Schema } from 'effect';

import { forwardAbort } from '#client/lib/abort.ts';
import { openStudyRpcSocket } from '#client/lib/host.ts';

import { sendFrames } from './frames';
import { frameSize, socketIdSchema } from './protocol';
import type { MobileRoom } from './room';

type Session = {
  write: (bytes: Uint8Array) => void;
  close: () => void;
};

type OpenAttempt = {
  id: string;
  cancel: AbortController;
  session?: Session;
};

const isSocketId = Schema.is(socketIdSchema);

export function servePairedRpc(connection: MobileRoom, authorized: (userId: string) => boolean) {
  const sessions = new Map<string, OpenAttempt>();
  const close = (peerId: string) => {
    const attempt = sessions.get(peerId);

    sessions.delete(peerId);
    attempt?.cancel.abort();
    attempt?.session?.close();
  };

  let disposed = false;

  connection.open.onReceive(
    ({ userId, byteLength }) => !disposed && authorized(userId) && byteLength <= 64
  );
  connection.open.onRequest(async (id, { peerId, userId, signal }) => {
    if (disposed || !authorized(userId) || !isSocketId(id) || signal.aborted) return false;

    close(peerId);
    const attempt: OpenAttempt = { id, cancel: new AbortController() };
    const cancellation = attempt.cancel.signal;
    const stopListening = forwardAbort(signal, attempt.cancel);

    sessions.set(peerId, attempt);

    try {
      const socket = await openStudyRpcSocket();

      if (cancellation.aborted || !authorized(userId)) {
        socket.close();
      } else {
        attempt.session = relaySocket(socket, connection, peerId, id);
        await waitForOpen(socket, cancellation);
        cancellation.throwIfAborted();

        if (authorized(userId)) return true;
      }
    } catch {
      // The peer gets a negative acknowledgement when the private socket cannot open.
    } finally {
      stopListening();
    }

    if (sessions.get(peerId) === attempt) close(peerId);

    return false;
  });

  connection.up.onReceive(
    ({ userId, byteLength, metadata, peerId }) =>
      authorized(userId) &&
      byteLength <= frameSize &&
      typeof metadata === 'string' &&
      sessions.get(peerId)?.id === metadata
  );
  connection.up.onMessage((bytes, { userId, peerId, metadata }) => {
    const session = sessions.get(peerId);

    if (session && authorized(userId) && session.id === metadata && bytes instanceof Uint8Array)
      session.session?.write(bytes);
  });

  connection.close.onReceive(({ userId, byteLength }) => authorized(userId) && byteLength <= 64);
  connection.close.onMessage((id, { peerId, userId }) => {
    if (authorized(userId) && sessions.get(peerId)?.id === id) close(peerId);
  });
  connection.room.onPeerLeave(({ peerId }) => close(peerId));

  return () => {
    disposed = true;

    for (const peerId of sessions.keys()) close(peerId);
  };
}

function waitForOpen(socket: WebSocket, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);

      return;
    }

    const listeners = new AbortController();
    const stop = () => {
      listeners.abort();
      signal.removeEventListener('abort', fail);
    };

    function fail() {
      stop();
      reject(new Error('Desktop RPC socket could not open'));
    }

    const options = { once: true, signal: listeners.signal };

    socket.addEventListener('error', fail, options);
    socket.addEventListener('close', fail, options);
    socket.addEventListener(
      'open',
      () => {
        stop();
        resolve();
      },
      options
    );
    signal.addEventListener('abort', fail, { once: true });
  });
}

function relaySocket(
  socket: WebSocket,
  connection: MobileRoom,
  peerId: string,
  id: string
): Session {
  const closed = new AbortController();
  const encoder = new TextEncoder();
  let sending = Promise.resolve();

  function finish() {
    if (closed.signal.aborted) return;

    closed.abort();
    socket.close();
  }

  socket.addEventListener(
    'message',
    ({ data }) => {
      const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);

      sending = sending.then(() => sendFrames(connection.down, bytes, peerId, id, closed.signal));
      void sending.catch(finish);
    },
    { signal: closed.signal }
  );
  socket.addEventListener(
    'close',
    () => {
      finish();
      void connection.close.send(id, { target: peerId }).catch(() => undefined);
    },
    { once: true }
  );

  return {
    close: finish,
    write(bytes) {
      if (socket.readyState === WebSocket.OPEN) socket.send(new Uint8Array(bytes));
    }
  };
}
