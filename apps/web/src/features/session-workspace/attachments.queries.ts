import type { SourceId, SessionId } from '@study/contracts/ids';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { toStudyError } from '../../lib/study-client/errors';
import { uploadSource } from './session-workspace.queries';

export type Attachment = {
  key: string;
  file: File;
  state: 'uploading' | 'ready' | 'rejected' | 'uncertain';
  sourceId?: SourceId;
  error?: unknown;
};

export const attachmentKey = (id: SessionId) => ['session-drafts', String(id), 'attachments'];

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

  async function upload(entry: Attachment) {
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

  return {
    items: state.data,
    add(files: File[]) {
      const entries: Attachment[] = files.map((file) => ({
        key: crypto.randomUUID(),
        file,
        state: 'uploading'
      }));

      update((items) => [...items, ...entries]);

      for (const entry of entries) void upload(entry);
    },
    retry(entry: Attachment) {
      const current = cache.getQueryData<Attachment[]>(key)?.find((item) => item.key === entry.key);

      if (current?.state === 'rejected') void upload(current);
    },
    remove(entry: Attachment) {
      update((items) => items.filter((item) => item.key !== entry.key));
    },
    accept(ids: readonly SourceId[]) {
      update((items) => items.filter((item) => !item.sourceId || !ids.includes(item.sourceId)));
    }
  };
}
