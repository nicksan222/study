import { fromStorage, invitationSchema, parseInvitation } from '@study/client/pairing';
import type { Invitation } from '@study/client/pairing';

export const linkKey = 'study.mobile.phone.v1';

export const inviteKey = 'study.mobile.invite.v1';

export type PairingError =
  | 'MobileAlreadyPaired'
  | 'MobileConnectionError'
  | 'MobileInviteWaitEnded'
  | 'MobileUnlinkError';

export function rememberInvitation(invitation: Invitation) {
  localStorage.setItem(inviteKey, JSON.stringify(invitation));

  return invitation;
}

export function importInvitation(url: string): PairingError | undefined {
  try {
    const incoming = parseInvitation(url);
    const paired = fromStorage(linkKey, invitationSchema);

    if (paired) return paired.room === incoming.room ? undefined : 'MobileAlreadyPaired';

    rememberInvitation(incoming);
  } catch {
    return 'MobileConnectionError';
  }
}

export function removeStored(key: string) {
  try {
    localStorage.removeItem(key);

    return true;
  } catch {
    return false;
  }
}

export function initialLink() {
  const paired = fromStorage(linkKey, invitationSchema);

  if (paired) return { invitation: paired, paired: true };

  return { invitation: fromStorage(inviteKey, invitationSchema), paired: false };
}
