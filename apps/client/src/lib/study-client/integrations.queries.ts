import type {
  integrationImportIdSchema,
  previewIntegrationInputSchema,
  startIntegrationImportSchema
} from '@study/contracts/integrations/schemas';
import { queryOptions } from '@tanstack/react-query';

import { request } from './request';

export const integrationsOptions = () =>
  queryOptions({
    queryKey: ['integrations'],
    queryFn: ({ signal }) =>
      request((client) => client['integrations.imports']({ limit: 30 }), signal),
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === 'running') ? 1000 : false
  });

export const integrationProvidersOptions = () =>
  queryOptions({
    queryKey: ['integration-providers'],
    queryFn: ({ signal }) => request((client) => client['integrations.providers']({}), signal)
  });

export const previewIntegrationImport = (input: typeof previewIntegrationInputSchema.Type) =>
  request((client) => client['integrations.previewImport'](input));

export const startIntegrationImport = (input: typeof startIntegrationImportSchema.Type) =>
  request((client) => client['integrations.startImport'](input));

export const cancelIntegrationImport = (id: typeof integrationImportIdSchema.Type) =>
  request((client) => client['integrations.cancelImport']({ id }));

export const retryIntegrationImport = (id: typeof integrationImportIdSchema.Type) =>
  request((client) => client['integrations.retryImport']({ id }));
