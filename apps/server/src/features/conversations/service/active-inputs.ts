/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Resolves complete active session material for immutable context capture.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses published document and source identities from public feature services.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ All material resolution runs within the caller owned synchronous transaction.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type {
  sessionContextIntentSchema,
  sessionSelectionTargetSchema
} from '@study/contracts/conversations/context';
import { StudyError } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';

import { SessionMaterialMembershipStore } from '#server/features/conversations/store/archive';
import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import type { Transaction } from '#server/platform/definitions/define-store';

/** Every active session membership supplies its current complete body automatically. */
export function activeSessionTargets(
  tx: Transaction,
  sessionId: SessionId,
  scope: Pick<typeof sessionContextIntentSchema.Type, 'throughMessageId' | 'threadRoot'> & {
    deferPendingAttachments?: boolean;
  } = {}
): Array<typeof sessionSelectionTargetSchema.Type> {
  const ids = tx.store(SessionMaterialMembershipStore).sessionMaterialMembership({
    sessionId,
    throughMessageId: scope.throughMessageId,
    threadRoot: scope.threadRoot
  });
  const targets: Array<typeof sessionSelectionTargetSchema.Type> = [];

  for (const id of ids.documents) {
    const owner = Documents.documentInTransaction(tx, { id });
    const version = owner.version;

    if (
      version?.status === 'published' &&
      version.document.blocks.some((block) => block.text.trim())
    )
      targets.push({
        input: { kind: 'document', versionId: version.id },
        scope: { kind: 'document' }
      });
  }

  for (const id of ids.sources) {
    const extraction = Sources.currentExtractionInTransaction(tx, id);

    if (!extraction) {
      if (scope.deferPendingAttachments && ids.deferredSourceIds.includes(id)) continue;

      throw new StudyError('not_enough', 'A session source is still being processed');
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
