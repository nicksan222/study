import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import { aiProviderSchema, apiKeyInputSchema } from '../settings/schemas.ts';
import {
  publicAccountSchema,
  signInAttemptSchema,
  signInStatusSchema,
  signInCallbackUrlSchema
} from './schemas.ts';

export const AuthRpc = RpcGroup.make(
  Rpc.make('providers', {
    payload: {},
    success: Schema.Array(aiProviderSchema),
    error: failureSchema
  }),
  Rpc.make('saveApiKey', {
    payload: apiKeyInputSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('status', { payload: {}, success: signInStatusSchema, error: failureSchema }),
  Rpc.make('publicAccount', {
    payload: {},
    success: Schema.UndefinedOr(publicAccountSchema),
    error: failureSchema
  }),
  Rpc.make('startSignIn', {
    payload: {
      reconsent: Schema.optionalKey(Schema.Boolean),
      callbackUrl: Schema.optionalKey(signInCallbackUrlSchema)
    },
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
