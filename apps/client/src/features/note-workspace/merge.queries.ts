import { rpc } from '@study/contracts/react';

export function useNoteMerge() {
  return rpc.notes.mergeNotes.useMutation();
}
