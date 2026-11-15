import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { SourceId, NoteId } from '@study/contracts/ids';
import { Atom } from 'effect/reactivity';
import type { AtomRegistry } from 'effect/reactivity';
import { useContext } from 'react';

import { toStudyError } from '#client/lib/study-client/errors.ts';

import { uploadSource } from './note-workspace.queries';

export type Attachment = {
  key: string;
  file: File;
  state: 'uploading' | 'ready' | 'rejected' | 'uncertain';
  sourceId?: SourceId;
  error?: unknown;
};

export const attachmentState = Atom.family((_id: NoteId) =>
  Atom.make<Attachment[]>([]).pipe(Atom.keepAlive)
);

/** Claims a draft upload before awaiting transport and records rejection separately from an uncertain result. */
async function uploadAttachment(cache: AtomRegistry.AtomRegistry, id: NoteId, entry: Attachment) {
  const update = (f: (items: Attachment[]) => Attachment[]) =>
    cache.update(attachmentState(id), (items) => f(items ?? []));

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

/** Adds note-owned draft entries before starting their independent uploads. */
function addAttachments(cache: AtomRegistry.AtomRegistry, id: NoteId, files: File[]) {
  const entries: Attachment[] = files.map((file) => ({
    key: crypto.randomUUID(),
    file,
    state: 'uploading'
  }));

  cache.update(attachmentState(id), (items) => [...(items ?? []), ...entries]);

  for (const entry of entries) void uploadAttachment(cache, id, entry);
}

export function useAttachments(id: NoteId) {
  const cache = useContext(RegistryContext);
  const atom = attachmentState(id);
  const items = useAtomValue(atom);
  const update = (f: (items: Attachment[]) => Attachment[]) =>
    cache.update(atom, (items) => f(items ?? []));

  return {
    items,
    add(files: File[]) {
      addAttachments(cache, id, files);
    },
    retry(entry: Attachment) {
      const current = cache.get(atom)?.find((item) => item.key === entry.key);

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
