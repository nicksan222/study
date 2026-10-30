import { AuthRpc } from '@study/contracts/auth/rpc';
import { Effect } from 'effect';

import { Auth } from '#server/features/auth/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const AuthRpcLive = defineRpc(
  AuthRpc,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return {
      'auth.status': () => auth.status(),
      'auth.publicAccount': () => auth.publicAccount(),
      'auth.startSignIn': (input) => auth.startSignIn(input),
      'auth.finishSignIn': (input) => auth.finishSignIn(input),
      'auth.cancelSignIn': (input) => auth.cancelSignIn(input),
      'auth.signOut': () => auth.signOut()
    };
  })
);
