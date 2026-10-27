import { router } from '#backend/runtime/trpc';

import { run as allSessions } from './all-sessions.ts';
import { run as createSession } from './create-session.ts';
import { run as createUntitledSession } from './create-untitled-session.ts';
import { run as deleteMessage } from './delete-message.ts';
import { run as deleteSession } from './delete-session.ts';
import { run as editMessage } from './edit-message.ts';
import { run as messages } from './messages.ts';
import { run as postMessage } from './post-message.ts';
import { run as reanswer } from './reanswer.ts';
import { run as regenerateTitle } from './regenerate-title.ts';
import { run as rewriteMessage } from './rewrite-message.ts';
import { run as session } from './session.ts';
import { run as sessionsBeingTitled } from './sessions-being-titled.ts';
import { run as setActiveVersion } from './set-active-version.ts';
import { run as thread } from './thread.ts';

export const conversationsRouter = router({
  allSessions,
  session,
  createSession,
  createUntitledSession,
  deleteSession,
  reanswer,
  rewriteMessage,
  editMessage,
  setActiveVersion,
  deleteMessage,
  messages,
  thread,
  postMessage,
  regenerateTitle,
  sessionsBeingTitled
});
