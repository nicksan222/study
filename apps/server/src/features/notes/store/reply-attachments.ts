/** @file Owns reply attachments within this feature. */

import type { pendingReplyAttachmentSchema, replySnapshotSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import {
  and,
  content_snapshots,
  eq,
  isNull,
  source_extraction_revisions,
  source_processing,
  sources,
  sql,
  workflowEvents
} from '@study/db';
import type { StoreResources } from '@study/server';

export function makeReplyAttachments({ db }: StoreResources) {
  function attachmentSource(
    part: {
      sourceId: typeof sources.$inferSelect.id;
      projectId: typeof sources.$inferSelect.project_id;
    },
    immutable = false
  ) {
    return db.orm
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.id, part.sourceId),
          immutable
            ? undefined
            : part.projectId === null
              ? isNull(sources.project_id)
              : eq(sources.project_id, part.projectId)
        )
      )
      .get();
  }

  function attachmentDocument(
    processing: typeof source_processing.$inferSelect | undefined,
    sourceId: typeof sources.$inferSelect.id
  ) {
    if (processing?.document_id == null) return undefined;

    if (
      !db.orm
        .select()
        .from(source_extraction_revisions)
        .where(
          and(
            eq(source_extraction_revisions.source_id, sourceId),
            eq(source_extraction_revisions.revision, processing.revision),
            eq(source_extraction_revisions.snapshot_id, processing.document_id)
          )
        )
        .get()
    )
      return undefined;

    return db.orm
      .select()
      .from(content_snapshots)
      .where(
        and(
          eq(content_snapshots.id, processing.document_id),
          eq(content_snapshots.source_id, sourceId)
        )
      )
      .get();
  }

  function assertSnapshotAttachments(result: typeof replySnapshotSchema.Type, immutable = false) {
    for (const item of result.messages)
      for (const part of item.attachments) {
        const document = db.orm
          .select()
          .from(content_snapshots)
          .where(
            and(
              eq(content_snapshots.id, part.snapshotId),
              eq(content_snapshots.source_id, part.sourceId)
            )
          )
          .get();

        const source = attachmentSource(part, immutable);

        if (!document || !source)
          throw new StudyError('invalid_input', 'captured attachment is unavailable');
      }

    assertPendingAttachments(result.pendingAttachments ?? [], immutable);
  }

  function assertPendingAttachments(
    parts: readonly (typeof pendingReplyAttachmentSchema.Type)[],
    immutable = false
  ) {
    for (const part of parts) {
      const source = attachmentSource(part, immutable);

      const processing = db.orm
        .select()
        .from(source_processing)
        .where(eq(source_processing.source_id, part.sourceId))
        .get();

      const failed = db.orm
        .select()
        .from(workflowEvents)
        .where(
          and(
            eq(workflowEvents.type, 'SourceProcessingFailed'),
            sql`json_extract(${workflowEvents.payload}, '$.sourceId') = ${String(part.sourceId)}`,
            sql`json_extract(${workflowEvents.payload}, '$.requestId') = ${part.requestId}`
          )
        )
        .get();

      if (
        !source ||
        !processing ||
        processing.revision !== part.inputRevision ||
        processing.request_id !== part.requestId ||
        failed
      )
        throw new StudyError('invalid_input', 'captured attachment processing is unavailable');
    }
  }

  return { attachmentDocument, assertSnapshotAttachments };
}
