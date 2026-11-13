import type { NoteId } from '@study/contracts/ids';
import type { noteWorkItemSchema, noteWorkPageSchema } from '@study/contracts/notes/work';
import { infiniteQueryOptions, mutationOptions } from '@tanstack/react-query';

import { request } from '#client/lib/study-client/request.ts';

import { cancelGeneration } from './note-workspace.queries';

export type NoteWorkItem = typeof noteWorkItemSchema.Type;

type Cursor = typeof noteWorkPageSchema.Type.next;

export const noteWorkKey = (id: NoteId) => ['note-work', String(id)];

export const noteWorkOptions = (id: NoteId) =>
  infiniteQueryOptions({
    queryKey: noteWorkKey(id),
    initialPageParam: null as Cursor,
    queryFn: ({ pageParam, signal }) =>
      request(
        (client) =>
          client['notes.noteWork']({
            noteId: id,
            limit: 20,
            before: pageParam ?? undefined
          }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 3000
  });

export const stopNoteWorkOptions = () =>
  mutationOptions({
    mutationFn: async (item: NoteWorkItem): Promise<void> => {
      if (item.kind === 'transform') await cancelGeneration(item.requestId);
      else
        await request((client) =>
          client['workflows.cancelExecution']({ id: item.execution.id, mode: 'safe' })
        );
    },
    retry: false
  });
