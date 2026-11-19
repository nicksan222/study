import { inviteDuration } from '@study/client/pairing';
import type { Invitation, OpenPhoneRpc } from '@study/client/pairing';
import { mobileRoom } from '@study/client/pairing/room';

import { openPeerRpc } from './rpc';

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
  let verified = false;
  let stopped = false;

  function open(signal: AbortSignal) {
    if (stopped || !current || !verified || !attempt)
      return Promise.reject(new Error('Desktop unavailable'));

    return openPeerRpc(connection, current, signal, attempt.signal);
  }

  async function activate() {
    if (stopped) return;

    const peer = Object.entries(connection.room.getPeers()).find(
      ([, info]) => info.userId === invitation.desktop
    )?.[0];

    if (peer === current) return;

    attempt?.abort(new Error('Desktop disconnected'));
    current = peer;

    if (verified || !peer) events.disconnected();

    verified = false;

    if (!peer) return;

    const pending = new AbortController();

    attempt = pending;

    try {
      await confirmPairing(peer, pending.signal);

      if (pending.signal.aborted) return;

      verified = true;
      events.connected(open);
    } catch {
      if (!pending.signal.aborted) events.error();
    }
  }

  async function confirmPairing(peer: string, signal: AbortSignal) {
    if (!paired) {
      const identity = await connection.room.getSelf();

      if (identity.identityPersistence !== 'local')
        throw new Error('Phone identity storage unavailable');

      signal.throwIfAborted();
      events.challenge(identity.userId.slice(-6));
    }

    const approved = await connection.requestPairing.request(null, {
      target: peer,
      timeoutMs: paired ? 10_000 : inviteDuration,
      signal
    });

    if (!approved) throw new Error('Pairing declined');

    signal.throwIfAborted();

    if (!paired) {
      events.paired();
      paired = true;
    }
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
    attempt?.abort(new Error('Phone disconnected'));

    return connection.room.leave();
  };
}
