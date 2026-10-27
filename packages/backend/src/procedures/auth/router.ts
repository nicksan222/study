import { router } from '#backend/runtime/trpc';

import { run as cancelChatgptSignIn } from './cancel-chatgpt-sign-in.ts';
import { run as connections } from './connections.ts';
import { run as finishChatgptSignIn } from './finish-chatgpt-sign-in.ts';
import { run as signOutChatgpt } from './sign-out-chatgpt.ts';
import { run as startChatgptSignIn } from './start-chatgpt-sign-in.ts';

export const authRouter = router({
  connections,
  startChatgptSignIn,
  finishChatgptSignIn,
  cancelChatgptSignIn,
  signOutChatgpt
});
