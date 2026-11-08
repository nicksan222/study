/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Resolves complete active note material for immutable context capture.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses published page and source identities from public feature services.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ All material resolution runs within the caller owned synchronous transaction.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { NoteId } from '@study/contracts/ids';
import type {
  noteContextIntentSchema,
  noteSelectionTargetSchema
} from '@study/contracts/notes/context';

import { NoteMaterialMembershipStore } from '#server/features/notes/store/archive';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import type { Transaction } from '#server/platform/definitions/define-store';

/** Every active note membership supplies its current complete body automatically. */
export function activeNoteTargets(
  tx: Transaction,
  noteId: NoteId,
  scope: Pick<typeof noteContextIntentSchema.Type, 'throughMessageId' | 'threadRoot'> & {
    deferPendingAttachments?: boolean;
  } = {}
): Array<typeof noteSelectionTargetSchema.Type> {
  const ids = tx.store(NoteMaterialMembershipStore).noteMaterialMembership({
    noteId,
    throughMessageId: scope.throughMessageId,
    threadRoot: scope.threadRoot
  });
  const targets: Array<typeof noteSelectionTargetSchema.Type> = [];

  for (const id of ids.pages) {
    const owner = Pages.pageInTransaction(tx, { id });
    const version = owner.version;

    if (
      version?.status === 'published' &&
      version.document.blocks.some((block) => block.text.trim())
    )
      targets.push({
        input: { kind: 'page', versionId: version.id },
        scope: { kind: 'document' }
      });
  }

  for (const id of ids.sources) {
    const extraction = Sources.currentExtractionInTransaction(tx, id);

    if (!extraction) {
      if (scope.deferPendingAttachments && ids.deferredSourceIds.includes(id)) continue;

      throw new StudyError('not_enough', 'A note source is still being processed');
    }

    if (extraction.document.blocks.some((block) => block.text.trim()))
      targets.push({
        input: {
          kind: 'source',
          sourceId: id,
          revision: extraction.revision,
          snapshotId: extraction.snapshotId
        },
        scope: { kind: 'document' }
      });
  }

  return targets;
}
