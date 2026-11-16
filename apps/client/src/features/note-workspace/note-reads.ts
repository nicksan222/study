import type { MessageId, NoteId, ProjectId, notePageInputSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';

import { useCursorWindow } from '#client/lib/cursor-window.tsx';

type Window<Cursor> = ReturnType<typeof useCursorWindow<Cursor>>;

function noteWindowInput<Cursor>(noteId: NoteId, pagination: Window<Cursor>) {
  return { noteId, before: pagination.cursor, limit: pagination.limit };
}

function withWindowNavigation<
  Cursor,
  Query extends { data?: { readonly next: Cursor | null }; isFetching: boolean }
>(state: Query, pagination: Window<Cursor>) {
  return {
    ...state,
    pagination,
    hasNextPage: state.data?.next != null,
    isFetchingNextPage: state.isFetching,
    fetchNextPage: () => pagination.more(state.data?.next)
  };
}

/** Each bounded live window refreshes its complete membership and ordering. */
export function useThreadPage(noteId: NoteId) {
  const pagination = useCursorWindow<MessageId>(String(noteId));
  const state = rpc.notes.thread.useQuery(noteWindowInput(noteId, pagination));

  return withWindowNavigation(state, pagination);
}

export function useNoteList(project?: ProjectId | null) {
  const pagination = useCursorWindow<NonNullable<typeof notePageInputSchema.Type.before>>(
    project === undefined ? 'all' : project === null ? 'unassigned' : String(project)
  );
  const state = rpc.notes.list.useQuery({
    project,
    before: pagination.cursor,
    limit: pagination.limit
  });

  return withWindowNavigation(state, pagination);
}

export function useNoteGenerations(noteId: NoteId) {
  const pagination = useCursorWindow<string>(String(noteId));

  return withWindowNavigation(
    rpc.notes.noteGenerations.useQuery(noteWindowInput(noteId, pagination)),
    pagination
  );
}
