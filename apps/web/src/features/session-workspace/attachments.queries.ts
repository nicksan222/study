import type { SourceId, SessionId } from '@study/contracts/ids';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { toStudyError } from '#web/lib/study-client/errors.ts';

import { uploadSource } from './session-workspace.queries';

export type Attachment = {
  key: string;
  file: File;
  state: 'uploading' | 'ready' | 'rejected' | 'uncertain';
  sourceId?: SourceId;
  error?: unknown;
};

export const attachmentKey = (id: SessionId) => ['session-drafts', String(id), 'attachments'];

/** Claims a draft upload before awaiting transport and records rejection separately from an uncertain result. */
async function uploadAttachment(cache: QueryClient, id: SessionId, entry: Attachment) {
  const update = (f: (items: Attachment[]) => Attachment[]) =>
    cache.setQueryData<Attachment[]>(attachmentKey(id), (items) => f(items ?? []));

  // Mark ownership before the first asynchronous boundary; another observer cannot replay it.
  update((items) =>
    items.map((item) =>
      item.key === entry.key ? { ...item, state: 'uploading', error: undefined } : item
    )
  );

  try {
    const source = await uploadSource(entry.file);

    update((items) =>
      items.map((item) =>
        item.key === entry.key ? { ...item, state: 'ready', sourceId: source.id } : item
      )
    );
    void cache.invalidateQueries({ queryKey: ['materials'] });
  } catch (error) {
    update((items) =>
      items.map((item) =>
        item.key === entry.key
          ? {
              ...item,
              state: toStudyError(error).kind === 'invalid_input' ? 'rejected' : 'uncertain',
              error
            }
          : item
      )
    );
  }
}

/** Adds session-owned draft entries before starting their independent uploads. */
function addAttachments(cache: QueryClient, id: SessionId, files: File[]) {
  const entries: Attachment[] = files.map((file) => ({
    key: crypto.randomUUID(),
    file,
    state: 'uploading'
  }));

  cache.setQueryData<Attachment[]>(attachmentKey(id), (items) => [...(items ?? []), ...entries]);

  for (const entry of entries) void uploadAttachment(cache, id, entry);
}

export function useAttachments(id: SessionId) {
  const cache = useQueryClient();
  const key = attachmentKey(id);
  const state = useQuery({
    queryKey: key,
    queryFn: () => [] as Attachment[],
    initialData: [] as Attachment[],
    staleTime: Infinity,
    gcTime: Infinity
  });
  const update = (f: (items: Attachment[]) => Attachment[]) =>
    cache.setQueryData<Attachment[]>(key, (items) => f(items ?? []));

  return {
    items: state.data,
    add(files: File[]) {
      addAttachments(cache, id, files);
    },
    retry(entry: Attachment) {
      const current = cache.getQueryData<Attachment[]>(key)?.find((item) => item.key === entry.key);

      if (current?.state === 'rejected') void uploadAttachment(cache, id, current);
    },
    remove(entry: Attachment) {
      update((items) => items.filter((item) => item.key !== entry.key));
    },
    accept(ids: readonly SourceId[]) {
      update((items) => items.filter((item) => !item.sourceId || !ids.includes(item.sourceId)));
    }
  };
}
