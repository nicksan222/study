import { AuthRpc } from '@study/contracts/auth/rpc';
import type { StudyError } from '@study/contracts/errors';
import { Effect } from 'effect';

import { Auth } from '#server/features/auth/service/index';

const mapError = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const AuthRpcLive = AuthRpc.toLayer(
  Effect.gen(function* () {
    const auth = yield* Auth;

    return {
      'auth.status': () => auth.status().pipe(Effect.mapError(mapError)),
      'auth.publicAccount': () => auth.publicAccount().pipe(Effect.mapError(mapError)),
      'auth.startSignIn': (input) => auth.startSignIn(input).pipe(Effect.mapError(mapError)),
      'auth.finishSignIn': (input) => auth.finishSignIn(input).pipe(Effect.mapError(mapError)),
      'auth.cancelSignIn': (input) => auth.cancelSignIn(input).pipe(Effect.mapError(mapError)),
      'auth.signOut': () => auth.signOut().pipe(Effect.mapError(mapError))
    };
  })
);
