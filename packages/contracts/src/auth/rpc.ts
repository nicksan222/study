import { Schema } from 'effect';

import { failureSchema } from '../errors.ts';
import { allDependencies, dependency, endpointGroup, liveQuery, mutation } from '../protocol.ts';
import { aiProviderSchema, apiKeyInputSchema } from '../settings/schemas.ts';
import {
  publicAccountSchema,
  signInAttemptSchema,
  signInStatusSchema,
  signInCallbackUrlSchema
} from './schemas.ts';

export const authEndpoints = {
  providers: liveQuery(
    'auth.providers',
    {
      payload: {},
      success: Schema.Array(aiProviderSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  saveApiKey: mutation(
    'auth.saveApiKey',
    {
      payload: apiKeyInputSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.auth] }
  ),
  status: liveQuery(
    'auth.status',
    { payload: {}, success: signInStatusSchema, error: failureSchema },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  publicAccount: liveQuery(
    'auth.publicAccount',
    {
      payload: {},
      success: Schema.UndefinedOr(publicAccountSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  startSignIn: mutation(
    'auth.startSignIn',
    {
      payload: {
        reconsent: Schema.optionalKey(Schema.Boolean),
        callbackUrl: Schema.optionalKey(signInCallbackUrlSchema)
      },
      success: signInAttemptSchema,
      error: failureSchema
    },
    { changes: 'external' }
  ),
  finishSignIn: mutation(
    'auth.finishSignIn',
    {
      payload: { attemptId: Schema.String },
      success: signInStatusSchema,
      error: failureSchema
    },
    { changes: [dependency.auth] }
  ),
  cancelSignIn: mutation(
    'auth.cancelSignIn',
    {
      payload: { attemptId: Schema.optionalKey(Schema.String) },
      success: Schema.Boolean,
      error: failureSchema
    },
    { changes: 'external' }
  ),
  signOut: mutation(
    'auth.signOut',
    { payload: {}, success: Schema.Void, error: failureSchema },
    { changes: [dependency.auth] }
  )
};

export const AuthRpc = endpointGroup(authEndpoints);
