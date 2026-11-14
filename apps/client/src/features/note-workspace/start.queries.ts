import type { ProjectId, NoteId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';
import { Atom } from 'effect/reactivity';

import { uploadSource } from './note-workspace.queries';

type CreationFlow = { id?: NoteId; uncertain?: boolean; pending?: boolean };

export const creationFlow = Atom.make<CreationFlow>({}).pipe(Atom.keepAlive);

/** Capture the originating draft and files before starting independent uploads. */
export async function startNote(input: {
  project?: ProjectId;
  draftKey: string;
  filesKey: string;
  text: string;
  files: File[];
}) {
  const sources = await Promise.all(input.files.map(uploadSource));

  return rpc.notes.createUntitledNote.call({
    project: input.project,
    initialMessage: { text: input.text, sourceIds: sources.map((source) => source.id) }
  });
}
