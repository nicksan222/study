/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Maps unsuccessful OAuth token endpoint responses to typed StudyError kinds. Shared │
 * │ classification keeps sign-in and refresh failures in the same domain error boundary.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports assertTokenResponse. Shared classification keeps sign-in and refresh failures  │
 * │   in the same domain error boundary.                                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ ChatGptSession and model construction consume this provider API; OAuth transport uses    │
 * │ platform/http and persisted credentials remain in Auth-owned storage.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';

export function assertTokenResponse(status: number, message: string) {
  if (status < 200 || status >= 300)
    throw new StudyError(
      [400, 401, 403].includes(status) ? 'auth' : status === 429 ? 'rate_limited' : 'transient',
      message
    );
}
