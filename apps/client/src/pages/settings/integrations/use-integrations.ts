import { projectIdSchema } from '@study/contracts';
import type { integrationImportIdSchema, integrationImportSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Schema } from 'effect';
import { useState } from 'react';

import { useNativeAction } from '#client/lib/effect/native.ts';

import { vaultFiles } from './files';

type ImportId = typeof integrationImportIdSchema.Type;

export function useIntegrations() {
  const imports = rpc.integrations.imports.useQuery({ limit: 100 });
  const providers = rpc.integrations.providers.useQuery({});
  const projectPage = rpc.projects.list.useQuery({ limit: 100 });
  const projects = { ...projectPage, data: projectPage.data?.items };
  const [providerId, setProviderId] = useState('obsidian');
  const [selected, setSelected] = useState<ImportId>();
  const [project, setProject] = useState('none');
  const [excluded, setExcluded] = useState<readonly string[]>([]);
  const [sourceKey, setSourceKey] = useState('');
  const previewRequest = rpc.integrations.previewImport.useMutation();
  const start = rpc.integrations.startImport.useMutation();
  const cancel = rpc.integrations.cancelImport.useMutation();
  const retry = rpc.integrations.retryImport.useMutation();
  const files = useNativeAction(vaultFiles);
  const preview = {
    ...previewRequest,
    isPending: previewRequest.isPending || files.isPending,
    isError: previewRequest.isError || files.isError
  };
  const action = {
    isPending: start.isPending || cancel.isPending || retry.isPending,
    isError: start.isError || cancel.isError || retry.isError,
    reset: () => {
      start.reset();
      cancel.reset();
      retry.reset();
    }
  };
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
    previewFiles: (input: readonly File[]) => {
      void files
        .mutateAsync(input)
        .then((vault) =>
          previewRequest.mutateAsync({
            ...vault,
            sourceKey: sourceKey.trim() || vault.sourceKey,
            providerId
          })
        )
        .then((state) => {
          setExcluded([]);
          setSelected(state.id);
        })
        .catch(() => {});
    },
    act: (state: typeof integrationImportSchema.Type, operation: 'start' | 'cancel' | 'retry') => {
      const run =
        operation === 'cancel'
          ? cancel.mutateAsync({ id: state.id })
          : operation === 'retry'
            ? retry.mutateAsync({ id: state.id })
            : start.mutateAsync({
                id: state.id,
                excludedKeys: excluded,
                projectId:
                  project === 'none'
                    ? undefined
                    : Schema.decodeUnknownSync(projectIdSchema)(BigInt(project))
              });

      void run.then((value) => setSelected(value.id)).catch(() => {});
    },
    busy: preview.isPending || action.isPending
  };
}
