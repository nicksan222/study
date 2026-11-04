/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Handles forwarded browser authorization callbacks through native authentication    │
 * │ services.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Returns an explicit authorization result without caching sensitive callback responses. │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This HTTP adapter delegates authorization ownership to the authentication service.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Effect } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

import { Auth } from '#server/features/auth/index';
import { signInCallbackPage } from '#server/platform/ai/auth/index';
import { recordAuthCallbackRejection } from '#server/platform/observability/index';

export const authCallbackRoutes = HttpRouter.add('GET', '/auth/callback', (request) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const accepted = yield* auth
      .receiveSignInCallback({ search: new URL(request.url, 'http://127.0.0.1').search })
      .pipe(Effect.catch(() => recordAuthCallbackRejection().pipe(Effect.as(false))));

    return HttpServerResponse.html(signInCallbackPage(accepted)).pipe(
      HttpServerResponse.setStatus(accepted ? 200 : 400),
      HttpServerResponse.setHeaders({
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      })
    );
  })
);
