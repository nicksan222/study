import type { ProjectId, NoteId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import type { RpcCallOptions } from '@study/contracts/react';
import { Atom } from 'effect/reactivity';

import { uploadSource } from './note-workspace.queries';

type CreationFlow = { id?: NoteId; uncertain?: boolean; pending?: boolean };

export const creationFlow = Atom.make<CreationFlow>({}).pipe(Atom.keepAlive);

/** A note starts from the same initial message on each client. */
export async function startNote(
  input: { project?: ProjectId; text: string; files: File[] },
  options?: RpcCallOptions
) {
  const sources = await Promise.all(input.files.map((file) => uploadSource(file, options)));

  return rpc.notes.createUntitledNote.call(
    {
      project: input.project,
      initialMessage: { text: input.text, sourceIds: sources.map((source) => source.id) }
    },
    options
  );
}
