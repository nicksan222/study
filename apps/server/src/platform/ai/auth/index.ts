/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Re-exports the server’s ChatGPT session, sign-in, and private account persistence  │
 * │ APIs. Provider implementations remain owned by the ChatGPT provider modules.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports AuthManager, SignIn, acquireSignIn, decodeAccount, encodeAccount. Provider     │
 * │   implementations remain owned by the ChatGPT provider modules.                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Auth feature and runtime wiring consume these exports; persistence codecs validate       │
 * │ stored account data while ChatGptSession owns live tokens.                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
export type { Account, AccessSeed } from '#server/platform/ai/providers/chatgpt/session';
export { SignIn, acquireSignIn } from '#server/platform/ai/providers/chatgpt/signin';
export { decodeAccount, encodeAccount } from '#server/platform/ai/auth/persistence';
