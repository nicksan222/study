/** @file Owns reply capture within this feature. */

import type {
  messageConversionSchema,
  pendingReplyAttachmentSchema,
  reanswerInputSchema,
  versionIdSchema
} from '@study/contracts';
import { StudyError } from '@study/contracts';
import {
  and,
  asc,
  desc,
  eq,
  message_parts,
  message_versions,
  messages,
  note_reply_requests,
  notes,
  source_processing,
  sources,
  sql
} from '@study/db';
import { unixSeconds } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makeHistory } from './history.ts';
import { makePersistence } from './persistence.ts';
import { makeReplyAttachments } from './reply-attachments.ts';
import { isAnswerTarget, keepsOriginalSelection } from './reply-identity.ts';
import type { requestInput } from './reply-schemas.ts';
import { codec } from './reply-schemas.ts';
import { makeReplySourceInputs } from './reply-source-inputs.ts';
import { makeThread } from './thread.ts';

export function makeReplyCapture({ db, clock, timestampClock }: StoreResources) {
  const { attachmentDocument } = makeReplyAttachments({ db, clock, timestampClock });
  const { insertSelectedVersion } = makePersistence({ db, clock, timestampClock });

  const { noteHistory, noteRoot } = makeHistory({ db, clock, timestampClock });

  const { assertThreadRoot } = makeThread({ db, clock, timestampClock });

  const sourceInputs = makeReplySourceInputs({ db, clock, timestampClock });

  /** Captures generation inputs and creates its pending version in the same transaction. */
  function snapshot(
    input: typeof requestInput.Type,
    target?: {
      messageId: typeof reanswerInputSchema.Type.messageId;
      origin: 'answer' | 'improve' | 'summarize' | 'instruction' | 'convert';
      conversion?: typeof messageConversionSchema.Type;
      instruction: string | null;
      questionVersionId?: typeof versionIdSchema.Type;
    }
  ) {
    const foundNote = db.orm.select().from(notes).where(eq(notes.id, input.noteId)).get();

    if (!foundNote) throw new StudyError('not_found', 'note not found');

    const note = foundNote;

    let totalAttachments = 0;

    const existing =
      target && db.orm.select().from(messages).where(eq(messages.id, target.messageId)).get();

    const threadRoot = existing?.thread_root ?? input.threadRoot;

    if (threadRoot != null) assertThreadRoot(note.id, threadRoot);

    assertSnapshotTarget();

    const captured = captureMessages();

    /** Conversion captures exclude unrelated history and unfinished replies. */
    function captureMessages() {
      if (input.context) return [...input.context.messages];

      if (target?.conversion) return captureConversion();

      return captureNote();
    }

    /** Reads the original complete version without changing its active selection. */
    function captureConversion() {
      const version =
        existing?.active_version_id == null
          ? undefined
          : db.orm
              .select()
              .from(message_versions)
              .where(
                and(
                  eq(message_versions.id, existing.active_version_id),
                  eq(message_versions.message_id, existing.id)
                )
              )
              .get();

      if (!existing || !version || version.status !== 'complete')
        throw new StudyError('invalid_input', 'Conversion input is unavailable');

      return [
        { messageId: existing.id, versionId: version.id, role: existing.role, text: version.text }
      ];
    }

    function captureNote() {
      let captured = noteHistory(note.id, target?.messageId, threadRoot ?? undefined);

      assertSnapshotTarget();

      captured = targetHistory(captured);

      if (threadRoot != null && !target && captured.at(-1)?.role !== 'user')
        throw new StudyError('invalid_input', 'reply target must be a user message');

      return captureThread(captured);
    }

    function assertSnapshotTarget() {
      if (target && (!existing || existing.note_id !== note.id))
        throw new StudyError('not_found', 'message not found');

      if (
        target?.origin === 'answer' &&
        !isAnswerTarget(existing || undefined, target.questionVersionId)
      )
        throw new StudyError('invalid_input', 'reanswer target must be an assistant reply');
    }

    function targetHistory(captured: ReturnType<typeof noteHistory>) {
      if (target) {
        const index = captured.findIndex((item) => item.messageId === target.messageId);

        if (index < 0) throw new StudyError('invalid_input', 'target is outside note context');

        captured = captured.slice(0, target.origin === 'answer' ? index : index + 1);

        if (target.origin === 'answer' && captured.at(-1)?.messageId !== existing!.reply_to)
          throw new StudyError('invalid_input', 'reply context is unavailable');
      }

      return captured;
    }

    function captureThread(captured: ReturnType<typeof noteHistory>) {
      if (threadRoot != null) {
        const rootPart = db.orm
          .select()
          .from(message_parts)
          .where(eq(message_parts.id, threadRoot))
          .get();

        if (!rootPart) throw new StudyError('invalid_input', 'invalid thread root');

        const root = noteRoot(note.id, rootPart.message_id);

        let total = root.text.length + captured.reduce((sum, item) => sum + item.text.length, 0);

        while (total > 200_000 && captured.length > 1) total -= captured.shift()!.text.length;

        if (total > 200_000)
          throw new StudyError('invalid_input', 'thread exceeds note context limit');

        captured = [root, ...captured];
      }

      return captured;
    }

    const pendingAttachments: (typeof pendingReplyAttachmentSchema.Type)[] = [];

    function resolveAttachment(
      part: typeof message_parts.$inferSelect,
      messageId: typeof messages.$inferSelect.id
    ) {
      if (part.source_id === null)
        throw new StudyError('invalid_input', 'attachment is unavailable');

      const source = db.orm.select().from(sources).where(eq(sources.id, part.source_id)).get();

      if (!source)
        throw new StudyError(
          'invalid_input',
          'attachment belongs to another project or is unavailable'
        );

      const processing = db.orm
        .select()
        .from(source_processing)
        .where(eq(source_processing.source_id, source.id))
        .get();

      const document = attachmentDocument(processing, source.id);

      if (!processing || !document || processing.published_request_id !== processing.request_id) {
        if (!processing)
          throw new StudyError('invalid_input', 'attachment processing is unavailable');

        pendingAttachments.push({
          messageId,
          partId: part.id,
          sourceId: source.id,
          sourceName: part.source_name,
          projectId: source.project_id,
          inputRevision: processing.revision,
          requestId: processing.request_id
        });

        return [];
      }

      return [
        {
          partId: part.id,
          sourceId: source.id,
          sourceName: part.source_name,
          snapshotId: document.id,
          revision: processing.revision,
          projectId: source.project_id
        }
      ];
    }

    const history = captured.map((message) => {
      const parts = db.orm
        .select()
        .from(message_parts)
        .where(
          and(
            eq(message_parts.message_id, message.messageId),
            sql`NOT EXISTS (
          SELECT 1 FROM note_sources a JOIN messages owner ON owner.note_id=a.note_id
          WHERE owner.id=${message_parts.message_id} AND a.source_id=${message_parts.source_id}
            AND a.archived_at IS NOT NULL
        )`
          )
        )
        .orderBy(asc(message_parts.ordinal))
        .limit(21)
        .all();

      totalAttachments += parts.length;

      if (parts.length > 20 || totalAttachments > 50)
        throw new StudyError('invalid_input', 'reply context has too many attachments');

      const selectedParts =
        threadRoot != null && !target?.conversion && message === captured[0]
          ? parts.filter((part) => part.id === threadRoot)
          : parts;

      const attachments = selectedParts.flatMap((part) => {
        return resolveAttachment(part, message.messageId);
      });

      return { ...message, attachments };
    });

    const { now, message, version } = createPendingReply();

    function generationFields() {
      return {
        origin: target?.origin ?? 'answer',
        instruction: target?.origin === 'instruction' ? target.instruction : null,
        based_on: existing?.active_version_id ?? null
      };
    }

    /** Allocates the next version while preserving selected originals for answers and conversions. */
    function createPendingReply() {
      const now = unixSeconds(timestampClock);

      const message =
        existing ??
        db.orm
          .insert(messages)
          .values({
            note_id: note.id,
            role: 'assistant',
            thread_root: threadRoot ?? null,
            reply_to: history.at(-1)?.role === 'user' ? history.at(-1)!.messageId : null,
            created_at: now
          })
          .returning()
          .get();

      const previous = db.orm
        .select()
        .from(message_versions)
        .where(eq(message_versions.message_id, message.id))
        .orderBy(desc(message_versions.number))
        .get();

      const values = {
        message_id: message.id,
        number: (previous?.number ?? 0n) + 1n,
        ...generationFields(),
        generation_request_id: input.requestId,
        status: 'pending' as const,
        text: '',
        created_at: now
      };
      const version = keepsOriginalSelection(target)
        ? db.orm.insert(message_versions).values(values).returning().get()
        : insertSelectedVersion(values);

      return { now, message, version };
    }

    const result = {
      requestId: input.requestId,
      noteId: note.id,
      messageId: message.id,
      versionId: version.id,
      contextRevision: note.context_revision,
      context: input.context,
      historyBoundary: input.context
        ? {
            includedMessages: history.length,
            excludedMessages: input.context.excludedMessages,
            reason: 'note-boundary' as const
          }
        : undefined,
      generation: target
        ? {
            origin: target.origin,
            instruction: target.instruction,
            questionVersionId: target.questionVersionId,
            conversion: target.conversion
          }
        : undefined,
      messages: history,
      ...(pendingAttachments.length ? { pendingAttachments } : {})
    };

    db.orm
      .insert(note_reply_requests)
      .values({
        request_id: input.requestId,
        note_id: note.id,
        version_id: version.id,
        snapshot: Schema.encodeSync(codec)(result)
      })
      .run();

    sourceInputs.retain(result);
    db.orm.update(notes).set({ updated_at: now }).where(eq(notes.id, note.id)).run();

    return result;
  }

  return { sourceInputs, snapshot };
}
