import { projectIdSchema } from '@study/contracts/ids';
import type { integrationImportSchema } from '@study/contracts/integrations/schemas';
import { mutationOptions } from '@tanstack/react-query';
import { Schema } from 'effect';

import {
  previewIntegrationImport,
  startIntegrationImport,
  cancelIntegrationImport,
  retryIntegrationImport
} from '#web/lib/study-client/integrations.queries.ts';

import { vaultFiles } from './files';

export const previewVaultOptions = () =>
  mutationOptions({
    mutationFn: async (input: {
      files: readonly File[];
      sourceKey: string;
      providerId: string;
    }) => {
      const vault = await vaultFiles(input.files);

      return previewIntegrationImport({
        ...vault,
        sourceKey: input.sourceKey.trim() || vault.sourceKey,
        providerId: input.providerId
      });
    }
  });

export const importActionOptions = () =>
  mutationOptions({
    mutationFn: (input: {
      state: typeof integrationImportSchema.Type;
      operation: 'start' | 'cancel' | 'retry';
      excluded: readonly string[];
      project: string;
    }) => {
      if (input.operation === 'cancel') return cancelIntegrationImport(input.state.id);

      if (input.operation === 'retry') return retryIntegrationImport(input.state.id);

      return startIntegrationImport({
        id: input.state.id,
        excludedKeys: input.excluded,
        projectId:
          input.project === 'none'
            ? undefined
            : Schema.decodeUnknownSync(projectIdSchema)(BigInt(input.project))
      });
    }
  });
