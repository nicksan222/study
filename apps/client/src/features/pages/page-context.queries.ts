import type { NoteId, PageId, PageVersionId } from '@study/contracts';
import { rpc } from '@study/contracts/react';

/** Pins an exact page version without replacing the note's other selected context. */
export async function attachPageToNote({
  pageId,
  versionId,
  noteId
}: {
  pageId: PageId;
  versionId: PageVersionId;
  noteId: NoteId;
}) {
  await rpc.pages.attach.call({ pageId, noteId });
  const selection = await rpc.notes.noteSelection.read({ noteId });
  const included = selection.targets.some(
    (target) =>
      target.input.kind === 'page' &&
      target.input.versionId === versionId &&
      target.scope.kind === 'document'
  );

  if (!included)
    await rpc.notes.updateNoteSelection.call({
      noteId,
      expectedRevision: selection.revision,
      targets: [
        ...selection.targets,
        { input: { kind: 'page', versionId }, scope: { kind: 'document' } }
      ]
    });
}
