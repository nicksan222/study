/** Receives browser OAuth on the same forwarded HTTP endpoint as Study's RPC. */
import { Effect } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

import { Auth } from '#server/features/auth/service/index';
import { signInCallbackPage } from '#server/platform/ai/auth/index';

export const authCallbackRoutes = HttpRouter.add('GET', '/auth/callback', (request) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const accepted = yield* auth
      .receiveSignInCallback({ search: new URL(request.url, 'http://127.0.0.1').search })
      .pipe(Effect.catch(() => Effect.succeed(false)));

    return HttpServerResponse.html(signInCallbackPage(accepted)).pipe(
      HttpServerResponse.setStatus(accepted ? 200 : 400),
      HttpServerResponse.setHeaders({
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      })
    );
  })
);
