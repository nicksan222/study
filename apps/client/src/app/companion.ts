/** Shared client operations and link protocol for the two companion-app hosts. */
export { startNote } from '../features/note-workspace/index';
export { setMobileBackground } from '../lib/host';
export { LanguageProvider, useI18n } from '../lib/i18n';
export { scheduleRequest } from '../lib/study-client/repeat-request';
export { toStudyError } from '../lib/study-client/errors';

export const loadPhoneConnection = () => import('../lib/mobile-link/phone-connection');

export type { OpenPhoneRpc } from '../lib/mobile-link/phone-connection';
export {
  fromStorage,
  invitationSchema,
  invitationUrl,
  parseInvitation
} from '../lib/mobile-link/protocol';
export type { Invitation } from '../lib/mobile-link/protocol';
export {
  desktopState,
  disconnectDesktop,
  reportBackgroundError,
  resumeDesktop,
  startInvitation,
  subscribeDesktop
} from '../lib/mobile-link/desktop';
