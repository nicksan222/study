import { router } from '#server/runtime/trpc';

import { run as allSessions } from './all-sessions/index.ts';
import { run as createSession } from './create-session/index.ts';
import { run as createUntitledSession } from './create-untitled-session/index.ts';
import { run as deleteMessage } from './delete-message/index.ts';
import { run as deleteSession } from './delete-session/index.ts';
import { run as editMessage } from './edit-message/index.ts';
import { run as messages } from './messages/index.ts';
import { run as postMessage } from './post-message/index.ts';
import { run as reanswer } from './reanswer/index.ts';
import { run as regenerateTitle } from './regenerate-title/index.ts';
import { run as rewriteMessage } from './rewrite-message/index.ts';
import { run as session } from './session/index.ts';
import { run as sessionsBeingTitled } from './sessions-being-titled/index.ts';
import { run as setActiveVersion } from './set-active-version/index.ts';
import { run as thread } from './thread/index.ts';

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
