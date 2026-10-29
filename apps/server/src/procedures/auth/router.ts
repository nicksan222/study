import { router } from '#server/runtime/trpc';

import { run as cancelChatgptSignIn } from './cancel-chatgpt-sign-in/index.ts';
import { run as connections } from './connections/index.ts';
import { run as finishChatgptSignIn } from './finish-chatgpt-sign-in/index.ts';
import { run as signOutChatgpt } from './sign-out-chatgpt/index.ts';
import { run as startChatgptSignIn } from './start-chatgpt-sign-in/index.ts';

export const authRouter = router({
  connections,
  startChatgptSignIn,
  finishChatgptSignIn,
  cancelChatgptSignIn,
  signOutChatgpt
});
