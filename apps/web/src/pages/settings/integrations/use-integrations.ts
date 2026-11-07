import type {
  integrationImportIdSchema,
  integrationImportSchema
} from '@study/contracts/integrations/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  integrationsOptions,
  integrationProvidersOptions
} from '#web/lib/study-client/integrations.queries.ts';
import { projectsQueryOptions } from '#web/lib/study-client/study.queries.ts';

import { previewVaultOptions, importActionOptions } from './import.queries';

type ImportId = typeof integrationImportIdSchema.Type;

export function useIntegrations() {
  const cache = useQueryClient();
  const imports = useQuery(integrationsOptions());
  const providers = useQuery(integrationProvidersOptions());
  const projects = useQuery(projectsQueryOptions());
  const [providerId, setProviderId] = useState('obsidian');
  const [selected, setSelected] = useState<ImportId>();
  const [project, setProject] = useState('none');
  const [excluded, setExcluded] = useState<readonly string[]>([]);
  const [sourceKey, setSourceKey] = useState('');
  const revision = imports.data
    ?.map(
      (run) =>
        `${run.id}:${run.status}:${run.items.filter((item) => item.status === 'imported').length}`
    )
    .join(',');

  useEffect(() => {
    for (const key of ['sessions', 'documents', 'sources', 'search'])
      void cache.invalidateQueries({ queryKey: [key] });
  }, [cache, revision]);

  const refresh = async (state: typeof integrationImportSchema.Type) => {
    setSelected(state.id);
    cache.setQueryData(integrationsOptions().queryKey, (previous) => [
      state,
      ...(previous ?? []).filter((item) => item.id !== state.id)
    ]);
    await cache.invalidateQueries({ queryKey: integrationsOptions().queryKey });
  };
  const preview = useMutation({
    ...previewVaultOptions(),
    onSuccess: async (state) => {
      setExcluded([]);
      await refresh(state);
    }
  });
  const action = useMutation({
    ...importActionOptions(),
    onSuccess: refresh
  });
  const current = imports.data?.find((item) => item.id === selected);

  return {
    imports,
    providers,
    projects,
    providerId,
    setProviderId: (value: string) => {
      setProviderId(value);
      setSelected(undefined);
    },
    sourceKey,
    setSourceKey: (value: string) => {
      setSourceKey(value);
      setSelected(undefined);
    },
    project,
    setProject,
    excluded,
    setExcluded,
    current,
    setSelected,
    preview,
    action,
    previewFiles: (files: readonly File[]) => preview.mutate({ files, sourceKey, providerId }),
    act: (state: typeof integrationImportSchema.Type, operation: 'start' | 'cancel' | 'retry') =>
      action.mutate({ state, operation, excluded, project }),
    busy: preview.isPending || action.isPending
  };
}
