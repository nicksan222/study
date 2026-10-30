import { Context } from 'effect';

import type { AuthManager } from './index.ts';

/** Runtime-owned provider session; account persistence and sign-in behavior belong to Auth. */
export class ChatGptSession extends Context.Service<
  ChatGptSession,
  {
    readonly manager: AuthManager;
    readonly issuer: string;
    readonly hostId: string;
    readonly request?: typeof fetch;
  }
>()('study/ChatGptSession') {}
