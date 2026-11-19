import {
  desktopLinkSchema,
  fromStorage,
  invitationUrl,
  scheduleRequest
} from '@study/client/pairing';
import type { DesktopLink } from '@study/client/pairing';
import type { MobileRoom } from '@study/client/pairing';

import { servePairedRpc } from './desktop-rpc';

const storageKey = 'study.mobile.desktop.v1';

const inviteDuration = 5 * 60_000;

type State = {
  link?: DesktopLink;
  invite?: string;
  approval?: { code: string; confirm: () => void };
  connected?: boolean;
  busy?: boolean;
  error?: boolean;
  revocationPending?: boolean;
  backgroundError?: boolean;
};

let state: State = {};

let active: MobileRoom | undefined;

let closeRpc: (() => void) | undefined;

let cancelExpiration: (() => void) | undefined;

let decline: (() => void) | undefined;

const subscribers = new Set<() => void>();

const currentRoom = () => active;

async function desktopIdentity(connection: MobileRoom) {
  const { userId, identityPersistence } = await connection.room.getSelf();

  if (identityPersistence !== 'local') throw new Error('Desktop identity storage unavailable');

  return userId;
}

function set(next: State) {
  state = next;

  for (const subscriber of subscribers) subscriber();
}

export function subscribeDesktop(listener: () => void) {
  subscribers.add(listener);

  return () => {
    subscribers.delete(listener);
  };
}

export const desktopState = () => state;

export const reportBackgroundError = () => set({ ...state, backgroundError: true });

function attach(connection: MobileRoom) {
  active = connection;
  const { room } = connection;
  const updateConnected = () => {
    if (connection !== active || !state.link) return;

    const connected = Object.values(room.getPeers()).some(
      (peer) => peer.userId === state.link?.phone
    );

    set({ ...state, connected, error: connected ? false : state.error });
  };

  room.onPeerJoin(updateConnected);
  room.onPeerLeave(updateConnected);
  room.onError(({ code }) => {
    if (
      connection === active &&
      (code === 'relay-failed' || code === 'identity-failed' || code === 'peer-connect-failed')
    )
      set({ ...state, error: true });
  });

  closeRpc = servePairedRpc(
    connection,
    (userId) => connection === active && state.link?.phone === userId
  );
}

export async function resumeDesktop(restart = false) {
  if (state.busy || state.revocationPending || (active && !restart)) return;

  const link = fromStorage(storageKey, desktopLinkSchema);

  if (!link) return;

  set({ link, busy: true });

  try {
    const previous = active;

    active = undefined;
    closeRpc?.();
    await previous?.room.leave();
    const { mobileRoom } = await import('@study/client/pairing/room');
    const connection = mobileRoom(link);

    attach(connection);
    connection.requestPairing.onReceive(
      ({ userId, byteLength }) => userId === link.phone && byteLength <= 64
    );
    connection.requestPairing.onRequest(
      (input, { userId }) => input === null && active === connection && userId === link.phone
    );

    if ((await desktopIdentity(connection)) !== link.desktop)
      throw new Error('Desktop identity changed');

    set({ ...state, busy: false });
  } catch {
    const previous = currentRoom();

    active = undefined;
    closeRpc?.();
    set({ link, error: true });
    await previous?.room.leave();
  }
}

export async function startInvitation() {
  if (active || state.busy || state.link || state.revocationPending) return;

  set({ busy: true });

  try {
    const { mobileRoom } = await import('@study/client/pairing/room');
    const room = crypto.randomUUID();
    const secret = crypto.randomUUID();
    const connection = mobileRoom({ room, secret });

    attach(connection);
    const desktop = await desktopIdentity(connection);

    const base =
      import.meta.env.VITE_STUDY_MOBILE_URL || 'https://nicksan222.github.io/study/mobile/';
    const expiresAt = Date.now() + inviteDuration;
    const url = invitationUrl(base, { room, secret, desktop, expiresAt });

    connection.requestPairing.onReceive(({ byteLength }) => byteLength <= 64);
    connection.requestPairing.onRequest((input, { userId: phone, signal }) => {
      if (connection !== active || input !== null) return false;

      if (state.link) return state.link.phone === phone;

      if (!state.invite || state.approval || Date.now() >= expiresAt) return false;

      return new Promise<boolean>((resolve) => {
        const abort = () => {
          if (decline !== cancel) return;

          decline = undefined;
          set({ ...state, approval: undefined });
          resolve(false);
        };
        const cancel = () => {
          signal.removeEventListener('abort', abort);
          resolve(false);
        };

        decline = cancel;
        signal.addEventListener('abort', abort, { once: true });
        set({
          ...state,
          approval: {
            code: phone.slice(-6),
            confirm: () => {
              if (connection !== active || state.link || signal.aborted || Date.now() >= expiresAt)
                return;

              signal.removeEventListener('abort', abort);

              const link = { room, secret, desktop, phone };

              try {
                localStorage.setItem(storageKey, JSON.stringify(link));
                cancelExpiration?.();
                decline = undefined;
                set({ link, connected: true });
                resolve(true);
              } catch {
                set({ ...state, approval: undefined, error: true });
                decline = undefined;
                resolve(false);
              }
            }
          }
        });
      });
    });
    cancelExpiration = scheduleRequest(disconnectDesktop, inviteDuration);
    set({ invite: url });
  } catch {
    await disconnectDesktop();
    set({ ...state, error: true });
  }
}

export async function disconnectDesktop() {
  cancelExpiration?.();
  decline?.();
  decline = undefined;
  const connection = active;

  active = undefined;
  closeRpc?.();
  closeRpc = undefined;
  set({ busy: true });
  let revocationPending = false;
  let leaveFailed = false;

  try {
    localStorage.removeItem(storageKey);
  } catch {
    revocationPending = true;
  }

  try {
    await connection?.room.leave();
  } catch {
    leaveFailed = true;
  }

  if (revocationPending) set({ error: true, revocationPending: true });
  else set(leaveFailed ? { error: true } : {});
}
