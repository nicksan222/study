import type { ProjectId, NoteId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Atom } from 'effect/reactivity';

type CreationFlow = { id?: NoteId; scope?: string | null; uncertain?: boolean; pending?: boolean };

export const creationFlow = Atom.make<CreationFlow>({}).pipe(Atom.keepAlive);

/** Save the writing draft as the initial version of the notebook body. */
export async function startNote(input: { project?: ProjectId; draftKey: string; text: string }) {
  return rpc.notes.createUntitledNote.call({
    project: input.project,
    initialMessage: { text: input.text, notebookBody: true }
  });
}
