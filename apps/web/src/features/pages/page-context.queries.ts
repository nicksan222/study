import type { NoteId, PageId, PageVersionId } from '@study/contracts/ids';
import { mutationOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

/** Pins the exact page version without replacing the note's other selected context. */
export const pageNoteOptions = () =>
  mutationOptions({
    retry: false,
    mutationFn: async ({
      pageId,
      versionId,
      noteId
    }: {
      pageId: PageId;
      versionId: PageVersionId;
      noteId: NoteId;
    }) => {
      await request((rpc) => rpc['pages.attach']({ pageId, noteId }));
      const selection = await request((rpc) => rpc['notes.noteSelection']({ noteId }));
      const included = selection.targets.some(
        (target) =>
          target.input.kind === 'page' &&
          target.input.versionId === versionId &&
          target.scope.kind === 'document'
      );

      if (!included)
        await request((rpc) =>
          rpc['notes.updateNoteSelection']({
            noteId,
            expectedRevision: selection.revision,
            targets: [
              ...selection.targets,
              { input: { kind: 'page', versionId }, scope: { kind: 'document' } }
            ]
          })
        );
    }
  });

export const archivePageOptions = (page: { id: PageId; archivedAt: bigint | null }) =>
  mutationOptions({
    mutationFn: () =>
      request((rpc) => rpc['pages.archive']({ id: page.id, archived: page.archivedAt === null }))
  });
