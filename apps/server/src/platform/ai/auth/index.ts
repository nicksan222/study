export { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
export type {
  Account,
  AccessSeed,
  AuthOptions
} from '#server/platform/ai/providers/chatgpt/session';
export { SignIn, acquireSignIn } from '#server/platform/ai/providers/chatgpt/signin';
export type { SignInOptions, SignInResult } from '#server/platform/ai/providers/chatgpt/signin';
export { decodeAccount, encodeAccount } from '#server/platform/ai/auth/persistence';
