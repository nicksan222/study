import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import {
  integrationImportKeySchema,
  integrationImportSchema,
  integrationProviderSchema,
  previewIntegrationInputSchema,
  startIntegrationImportSchema
} from './schemas.ts';

export const IntegrationsRpc = RpcGroup.make(
  Rpc.make('providers', {
    payload: Schema.Struct({}),
    success: Schema.Array(integrationProviderSchema),
    error: failureSchema
  }),
  Rpc.make('previewImport', {
    payload: previewIntegrationInputSchema,
    success: integrationImportSchema,
    error: failureSchema
  }),
  Rpc.make('startImport', {
    payload: startIntegrationImportSchema,
    success: integrationImportSchema,
    error: failureSchema
  }),
  Rpc.make('import', {
    payload: integrationImportKeySchema,
    success: integrationImportSchema,
    error: failureSchema
  }),
  Rpc.make('imports', {
    payload: Schema.Struct({
      limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
    }),
    success: Schema.Array(integrationImportSchema),
    error: failureSchema
  }),
  Rpc.make('cancelImport', {
    payload: integrationImportKeySchema,
    success: integrationImportSchema,
    error: failureSchema
  }),
  Rpc.make('retryImport', {
    payload: integrationImportKeySchema,
    success: integrationImportSchema,
    error: failureSchema
  })
).prefix('integrations.');
