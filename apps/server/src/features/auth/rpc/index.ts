/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Maps the browser-safe authentication RPC requests to the auth service operations.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps wire request names and typed payloads aligned with auth service methods.         │
 * │ - Preserves the public contract while delegating domain behavior to the service.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ RPC schemas come from @study/contracts; domain decisions and persistence remain owned by │
 * │ the auth service.                                                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { AuthRpc } from '@study/contracts/auth/rpc';

import { Auth } from '#server/features/auth/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const AuthRpcLive = defineRpc(AuthRpc, { auth: Auth }, ({ auth }) => ({
  'auth.providers': () => auth.providers(),
  'auth.saveApiKey': auth.saveApiKey,
  'auth.status': () => auth.status(),
  'auth.publicAccount': () => auth.publicAccount(),
  'auth.startSignIn': auth.startSignIn,
  'auth.finishSignIn': auth.finishSignIn,
  'auth.cancelSignIn': auth.cancelSignIn,
  'auth.signOut': () => auth.signOut()
}));
