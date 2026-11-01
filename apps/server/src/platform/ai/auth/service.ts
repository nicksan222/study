/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines the runtime-owned ChatGPT session capability consumed by authentication    │
 * │ and AI services. It carries the session manager and host/provider configuration without  │
 * │ owning account persistence.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports ChatGptSession. It carries the session manager and host/provider configuration │
 * │   without owning account persistence.                                                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Auth feature and runtime wiring consume these exports; persistence codecs validate       │
 * │ stored account data while ChatGptSession owns live tokens.                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

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
