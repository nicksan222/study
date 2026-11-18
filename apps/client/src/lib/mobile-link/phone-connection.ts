import { openPeerRpc } from './phone-rpc';
import type { Invitation } from './protocol';
import { mobileRoom } from './room';

export type OpenPhoneRpc = (
  signal: AbortSignal
) => Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }>;

export function connectPhone(
  invitation: Invitation,
  paired: boolean,
  events: {
    challenge: (code: string) => void;
    paired: () => void;
    connected: (open: OpenPhoneRpc) => void;
    disconnected: () => void;
    error: () => void;
  }
) {
  const connection = mobileRoom(invitation);
  let current: string | undefined;
  let attempt: AbortController | undefined;
  let stopped = false;

  function open(signal: AbortSignal) {
    if (!current || !paired) return Promise.reject(new Error('Desktop unavailable'));

    return openPeerRpc(connection, current, signal);
  }

  async function activate() {
    const peer = Object.entries(connection.room.getPeers()).find(
      ([, info]) => info.userId === invitation.desktop
    )?.[0];

    if (peer === current) return;

    attempt?.abort();
    current = peer;

    if (!peer) {
      events.disconnected();

      return;
    }

    const pending = new AbortController();

    attempt = pending;

    try {
      if (!paired) await confirmPairing(peer, pending.signal);

      if (!pending.signal.aborted) events.connected(open);
    } catch {
      if (!pending.signal.aborted) events.error();
    }
  }

  async function confirmPairing(peer: string, signal: AbortSignal) {
    const identity = await connection.room.getSelf();

    if (identity.identityPersistence !== 'local')
      throw new Error('Phone identity storage unavailable');

    signal.throwIfAborted();
    events.challenge(identity.userId.slice(-6));

    const approved = await connection.requestPairing.request(null, {
      target: peer,
      timeoutMs: 300_000,
      signal
    });

    if (!approved) throw new Error('Pairing declined');

    signal.throwIfAborted();
    events.paired();
    paired = true;
  }

  connection.room.onPeerJoin(() => void activate(), { replay: true });
  connection.room.onPeerLeave(() => void activate());
  connection.room.onError(({ code }) => {
    if (
      !stopped &&
      (code === 'relay-failed' || code === 'identity-failed' || code === 'peer-connect-failed')
    )
      events.error();
  });

  return () => {
    stopped = true;
    attempt?.abort();

    return connection.room.leave();
  };
}
