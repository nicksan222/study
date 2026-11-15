import type { NoteId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';

/** Live settings and persisted note summaries update through committed revisions. */
export function useSidebarProgress() {
  const settings = rpc.settings.sidebarSettings.useQuery({});
  const progress = rpc.notes.noteSummaries.useQuery({});

  return { settings, progress };
}

export function useNoteSettlement(id: NoteId) {
  const mutation = rpc.notes.setNoteSettled.useMutation();

  return { ...mutation, mutate: (settled: boolean) => mutation.mutate({ id, settled }) };
}
