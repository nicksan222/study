import { joinRoom } from 'trystero';

import { frameSize } from './protocol';
import type { Invitation } from './protocol';

export function mobileRoom(invitation: Pick<Invitation, 'room' | 'secret'>) {
  const room = joinRoom(
    {
      appId: 'io.github.nicksan222.study.mobile.v1',
      password: invitation.secret,
      identity: 'local',
      maxReceiveBytes: frameSize * 4,
      relayConfig: {
        urls: [
          'wss://relay.primal.net',
          'wss://relay.nostr.net',
          'wss://relay.ditto.pub',
          'wss://nostr-pub.wellorder.net',
          'wss://relay.nostrhub.fr'
        ]
      }
    },
    invitation.room
  );

  return {
    room,
    requestPairing: room.makeAction<null, boolean>('pair', { kind: 'request' }),
    open: room.makeAction<string, boolean>('rpc-open', { kind: 'request' }),
    up: room.makeAction<Uint8Array>('rpc-up'),
    down: room.makeAction<Uint8Array>('rpc-down'),
    close: room.makeAction<string>('rpc-close')
  };
}

export type MobileRoom = ReturnType<typeof mobileRoom>;
