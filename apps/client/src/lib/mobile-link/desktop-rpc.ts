import { Schema } from 'effect';

import { openStudyRpcSocket } from '#client/lib/host.ts';

import { sendFrames } from './frames';
import { frameSize, socketIdSchema } from './protocol';
import type { MobileRoom } from './room';

type Session = {
  id: string;
  write: (bytes: Uint8Array) => void;
  close: () => void;
};

const isSocketId = Schema.is(socketIdSchema);

export function servePairedRpc(connection: MobileRoom, authorized: (userId: string) => boolean) {
  const sessions = new Map<string, Session>();
  const close = (peerId: string) => {
    const session = sessions.get(peerId);

    sessions.delete(peerId);
    session?.close();
  };

  connection.open.onReceive(({ userId, byteLength }) => authorized(userId) && byteLength <= 64);
  connection.open.onRequest(async (id, { peerId, userId, signal }) => {
    if (!authorized(userId) || !isSocketId(id)) return false;

    close(peerId);
    const socket = await openStudyRpcSocket();
    const session = relaySocket(socket, connection, peerId, id);

    sessions.set(peerId, session);

    try {
      await waitForOpen(socket, signal);

      if (sessions.get(peerId) !== session || !authorized(userId)) {
        session.close();

        return false;
      }

      return true;
    } catch {
      session.close();

      return false;
    }
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
      session.write(bytes);
  });

  connection.close.onReceive(({ userId, byteLength }) => authorized(userId) && byteLength <= 64);
  connection.close.onMessage((id, { peerId, userId }) => {
    if (authorized(userId) && sessions.get(peerId)?.id === id) close(peerId);
  });
  connection.room.onPeerLeave(({ peerId }) => close(peerId));

  return () => {
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
    id,
    close: finish,
    write(bytes) {
      if (socket.readyState === WebSocket.OPEN) socket.send(new Uint8Array(bytes));
    }
  };
}
