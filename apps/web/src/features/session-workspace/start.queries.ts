import type { ProjectId, SessionId } from '@study/contracts/ids';
import { queryOptions } from '@tanstack/react-query';

import { createSession } from '#web/lib/study-client/operations.ts';

import { uploadSource } from './session-workspace.queries';

export type CreationFlow = { id?: SessionId; uncertain?: boolean; pending?: boolean };

export const startDraftOptions = (queryKey: string[]) =>
  queryOptions({
    queryKey,
    queryFn: () => '',
    initialData: '',
    gcTime: Infinity,
    staleTime: Infinity
  });

export const startFilesOptions = (queryKey: string[]) =>
  queryOptions({
    queryKey,
    queryFn: () => [] as File[],
    initialData: [] as File[],
    gcTime: Infinity,
    staleTime: Infinity
  });

export const creationFlowOptions = () =>
  queryOptions({
    queryKey: ['session-workspace', 'creation'],
    queryFn: (): CreationFlow => ({}),
    initialData: {} as CreationFlow,
    gcTime: Infinity,
    staleTime: Infinity
  });

/** The mutation retains its originating draft keys when the selected project changes. */
export const startSessionMutation = {
  mutationFn: async (input: {
    project?: ProjectId;
    draftKey: string[];
    filesKey: string[];
    text: string;
    files: File[];
  }) => {
    const sources = await Promise.all(input.files.map(uploadSource));

    return createSession(input.project, {
      text: input.text,
      sourceIds: sources.map((source) => source.id)
    });
  },
  retry: false
};
