import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import { publicAccountSchema, signInAttemptSchema, signInStatusSchema } from './schemas.ts';

export const AuthRpc = RpcGroup.make(
  Rpc.make('status', { payload: {}, success: signInStatusSchema, error: failureSchema }),
  Rpc.make('publicAccount', {
    payload: {},
    success: Schema.UndefinedOr(publicAccountSchema),
    error: failureSchema
  }),
  Rpc.make('startSignIn', {
    payload: { reconsent: Schema.optionalKey(Schema.Boolean) },
    success: signInAttemptSchema,
    error: failureSchema
  }),
  Rpc.make('finishSignIn', {
    payload: { attemptId: Schema.String },
    success: signInStatusSchema,
    error: failureSchema
  }),
  Rpc.make('cancelSignIn', {
    payload: { attemptId: Schema.optionalKey(Schema.String) },
    success: Schema.Boolean,
    error: failureSchema
  }),
  Rpc.make('signOut', { payload: {}, success: Schema.Void, error: failureSchema })
).prefix('auth.');
