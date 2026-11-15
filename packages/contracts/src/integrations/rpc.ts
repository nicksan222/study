import { Schema } from 'effect';

import { failureSchema } from '../errors.ts';
import { allDependencies, dependency, endpointGroup, liveQuery, mutation } from '../protocol.ts';
import {
  integrationImportKeySchema,
  integrationImportSchema,
  integrationProviderSchema,
  previewIntegrationInputSchema,
  startIntegrationImportSchema
} from './schemas.ts';

export const integrationsEndpoints = {
  providers: liveQuery(
    'integrations.providers',
    {
      payload: Schema.Struct({}),
      success: Schema.Array(integrationProviderSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  previewImport: mutation(
    'integrations.previewImport',
    {
      payload: previewIntegrationInputSchema,
      success: integrationImportSchema,
      error: failureSchema
    },
    { changes: [dependency.integrations] }
  ),
  startImport: mutation(
    'integrations.startImport',
    {
      payload: startIntegrationImportSchema,
      success: integrationImportSchema,
      error: failureSchema
    },
    { changes: [dependency.integrations] }
  ),
  import: liveQuery(
    'integrations.import',
    {
      payload: integrationImportKeySchema,
      success: integrationImportSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  imports: liveQuery(
    'integrations.imports',
    {
      payload: Schema.Struct({
        limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
      }),
      success: Schema.Array(integrationImportSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  cancelImport: mutation(
    'integrations.cancelImport',
    {
      payload: integrationImportKeySchema,
      success: integrationImportSchema,
      error: failureSchema
    },
    { changes: [dependency.integrations] }
  ),
  retryImport: mutation(
    'integrations.retryImport',
    {
      payload: integrationImportKeySchema,
      success: integrationImportSchema,
      error: failureSchema
    },
    { changes: [dependency.integrations] }
  )
};

export const IntegrationsRpc = endpointGroup(integrationsEndpoints);
