/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists reply-generation state and its resulting assistant message.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Persists pending reply context and the assistant message produced on completion.       │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the notes service applies policy and            │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { noteGenerationRequestedSchema } from '@study/contracts/events';
import { sourceIdSchema } from '@study/contracts/ids';
import { versionIdSchema } from '@study/contracts/ids';
import { selectionReferenceKey } from '@study/contracts/notes/context';
import { runSelectionContextSchema } from '@study/contracts/notes/context';
import { runPreferencesSchema } from '@study/contracts/notes/context';
import type { messageConversionSchema } from '@study/contracts/notes/conversion';
import { convertMessageInputSchema } from '@study/contracts/notes/conversion';
import {
  anchorSchema,
  reanswerInputSchema,
  publishReplyInputSchema,
  replyRequestInputSchema,
  replyRequestSchema,
  rewriteMessageInputSchema,
  replySnapshotInputSchema,
  replySnapshotSchema,
  replyVersionInputSchema,
  replyVersionSchema,
  pendingReplyAttachmentSchema
} from '@study/contracts/notes/schemas';
import { NoteMode } from '@study/contracts/notes/schemas';
import { isNull, and, asc, desc, eq, sql } from '@study/db';
import {
  blocks,
  citations,
  note_reply_requests,
  content_snapshots,
  message_parts,
  message_versions,
  messages,
  notes,
  source_processing,
  source_extraction_revisions,
  sources,
  workflowEvents,
  note_run_contexts,
  workflow_retired_correlations,
  workflowReceipts
} from '@study/db/schema';
import { text } from '@study/localization';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';
import { decodeEvent } from '#server/platform/workflows/events';

import { makeAssertContextAvailable } from './context-availability.ts';
import { makeHistory } from './history.ts';
import { makeDiscardPending } from './pending.ts';
import { makePersistence } from './persistence.ts';
import { makeReplySourceInputs } from './reply-source-inputs.ts';
import { makeThread } from './thread.ts';

type ReplyCitation = (typeof publishReplyInputSchema.Type.citations)[number];

type SelectedInput = (typeof runSelectionContextSchema.Type.inputs)[number];

function replyTargetPredicate(input: typeof replyVersionInputSchema.Type) {
  return and(
    eq(message_versions.id, input.versionId),
    eq(messages.id, input.messageId),
    eq(messages.note_id, input.noteId)
  );
}

function citationExcerpt(selected: SelectedInput, citation: ReplyCitation) {
  const range = citation.selectedRange;

  if (!range) return undefined;

  return selected.excerpts.find(
    (item) =>
      item.blockOrdinal === citation.blockOrdinal &&
      item.blockId === range.blockId &&
      item.start === range.start &&
      item.end === range.end &&
      item.text.includes(citation.quote)
  );
}

function selectedCitationIdentity(input: SelectedInput['input']) {
  return input.kind === 'source'
    ? { source_id: input.sourceId, authored_version_id: null, source_revision: input.revision }
    : { source_id: null, authored_version_id: input.versionId, source_revision: null };
}

const receiptCitationFields = [
  'marker',
  'source_id',
  'source_name',
  'authored_version_id',
  'source_revision',
  'document_id',
  'block_id',
  'range_start',
  'range_end',
  'anchor',
  'quote'
] as const;

type ReceiptCitation = Pick<typeof citations.$inferSelect, (typeof receiptCitationFields)[number]>;

function sameReceiptCitation(actual: ReceiptCitation, expected: ReceiptCitation) {
  return receiptCitationFields.every((key) => actual[key] === expected[key]);
}

const codec = Schema.fromJsonString(Schema.toCodecJson(replySnapshotSchema));

const persistedCodec = Schema.fromJsonString(
  Schema.toCodecJson(
    Schema.Struct({
      ...replySnapshotSchema.fields,
      publication: Schema.optional(Schema.String),
      publicationText: Schema.optional(Schema.String)
    })
  )
);

const requestInput = Schema.Struct({
  ...replyRequestInputSchema.fields,
  requestId: Schema.String,
  context: Schema.optional(runSelectionContextSchema)
});

/** Binds immutable reply captures and publication checks to one database scope. */
function makeHelpers({ db, clock, timestampClock }: StoreResources) {
  const discardPending = makeDiscardPending({ db, clock, timestampClock });

  const assertContextAvailable = makeAssertContextAvailable({ db, clock, timestampClock });

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

  function replyContext(requestId: string, actionable = true) {
    assertContextAvailable(requestId, actionable);

    const row = db.orm
      .select()
      .from(note_reply_requests)
      .where(eq(note_reply_requests.request_id, requestId))
      .get();

    if (!row) throw new StudyError('not_found', 'reply request not found');

    const result = Schema.decodeUnknownSync(codec)(row.snapshot);

    const note = db.orm.select().from(notes).where(eq(notes.id, row.note_id)).get();

    const target = db.orm.select().from(messages).where(eq(messages.id, result.messageId)).get();

    const version = db.orm
      .select()
      .from(message_versions)
      .where(eq(message_versions.id, row.version_id))
      .get();

    return { row, result, note, target, version };
  }

  /** Rejects stale selections and unavailable evidence before returning an actionable capture. */
  function readReplySnapshot(input: typeof replySnapshotInputSchema.Type) {
    const { row, result, note, target, version } = replyContext(input.requestId);

    if (
      !note ||
      !matchesRequest(result, row) ||
      !replyContextMatches(result, note) ||
      !replySelectionMatches(target, version, result)
    )
      throw new StudyError('invalid_input', 'reply request is stale');

    sourceInputs.assert(result);
    assertSnapshotAttachments(result);

    return result;
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

  function retirePending(message: typeof messages.$inferSelect, preserveShell = false) {
    const pending = db.orm
      .select()
      .from(message_versions)
      .where(
        and(
          eq(message_versions.message_id, message.id),
          sql`${message_versions.status} IN ('pending', 'writing')`
        )
      )
      .all();

    for (const version of pending) discardPending(message, version, preserveShell);
  }

  /** Blocks overlapping active work and ignores failed conversions when preparing a new reply. */
  function prepareReply(input: typeof replyRequestInputSchema.Type) {
    const pending = db.orm
      .select({ message: messages, version: message_versions })
      .from(messages)
      .innerJoin(message_versions, eq(message_versions.message_id, messages.id))
      .where(
        and(
          eq(messages.note_id, input.noteId),
          sql`${message_versions.status} NOT IN ('complete', 'failed')`
        )
      )
      .limit(101)
      .all();

    if (pending.length > 100) throw new StudyError('invalid_input', 'too many pending versions');

    let activeRequest = false;

    for (const item of pending) {
      const request = db.orm
        .select()
        .from(note_reply_requests)
        .where(eq(note_reply_requests.version_id, item.version.id))
        .get();

      if (!request) {
        activeRequest = true;
        continue;
      }

      try {
        readReplySnapshot({ requestId: request.request_id });
        activeRequest = true;
      } catch (error) {
        if (!(error instanceof StudyError) || !['invalid_input', 'not_found'].includes(error.kind))
          throw error;

        discardPending(item.message, item.version);
      }
    }

    if (activeRequest) throw new StudyError('invalid_input', 'note already has a pending version');
  }

  return {
    snapshot,
    readReplySnapshot,
    assertSnapshotAttachments,
    discardPending,
    retirePending,
    replyContext,
    attachmentDocument,
    prepareReply
  };
}

export const RetainedReplySnapshotStore = defineStore({
  name: 'study/RetainedReplySnapshotStore',
  entity: { singular: 'retainedReplySnapshot', plural: 'retainedReplySnapshots' },
  make: (resources) => {
    const { replyContext } = makeHelpers(resources);

    return {
      queries: {
        retainedReplySnapshot: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: replySnapshotSchema,
          run: ({ requestId }) => replyContext(requestId, false).result
        })
      },
      mutations: {}
    };
  }
});

export const ReplyVersionStore = defineStore({
  name: 'study/ReplyVersionStore',
  entity: { singular: 'replyVersion', plural: 'replyVersions' },
  make: (resources) => {
    const { db } = resources;
    const { assertSnapshotAttachments } = makeHelpers(resources);

    function matchesRetainedRequest(
      retained: typeof note_reply_requests.$inferSelect,
      requestId: string,
      noteId: typeof messages.$inferSelect.note_id
    ) {
      return retained.request_id === requestId && retained.note_id === noteId;
    }

    function snapshotAvailable(retained: typeof note_reply_requests.$inferSelect) {
      try {
        assertSnapshotAttachments(Schema.decodeUnknownSync(codec)(retained.snapshot), true);

        return true;
      } catch (error) {
        if (
          error instanceof StudyError &&
          (error.kind === 'not_found' || error.kind === 'invalid_input')
        )
          return false;

        throw error;
      }
    }

    function retainedState(
      requestId: string,
      retained: typeof note_reply_requests.$inferSelect | undefined
    ) {
      const retired = db.orm
        .select()
        .from(workflow_retired_correlations)
        .where(
          and(
            eq(workflow_retired_correlations.correlation_id, requestId),
            eq(workflow_retired_correlations.event_type, 'NoteGenerationRequested')
          )
        )
        .get();

      if (retired) return { state: 'retired' as const, requestId };

      const context = db.orm
        .select()
        .from(note_run_contexts)
        .where(eq(note_run_contexts.request_id, requestId))
        .get();

      if (!retained || !context) return { state: 'unavailable' as const, requestId };

      return {
        state: snapshotAvailable(retained) ? ('available' as const) : ('unavailable' as const),
        requestId
      };
    }

    return {
      queries: {
        replyVersion: storeQuery({
          role: 'required',
          input: replyVersionInputSchema,
          output: replyVersionSchema,
          run: (input) => {
            const row = db.orm
              .select({ version: message_versions, message: messages })
              .from(message_versions)
              .innerJoin(messages, eq(messages.id, message_versions.message_id))
              .where(replyTargetPredicate(input))
              .get();

            if (!row) throw new StudyError('not_found', 'Message version is unavailable');

            if (row.version.origin === 'typed' || row.version.origin === 'edited')
              return { state: 'manual' as const };

            const retained = db.orm
              .select()
              .from(note_reply_requests)
              .where(eq(note_reply_requests.version_id, input.versionId))
              .get();
            const requestId = row.version.generation_request_id ?? retained?.request_id ?? null;

            if (requestId === null) return { state: 'unavailable' as const, requestId };

            if (retained && !matchesRetainedRequest(retained, requestId, input.noteId))
              return { state: 'unavailable' as const, requestId };

            return retainedState(requestId, retained);
          }
        })
      },
      mutations: {}
    };
  }
});

export const ReplyRequestStore = defineStore({
  name: 'study/ReplyRequestStore',
  entity: { singular: 'replyRequest', plural: 'replyRequests' },
  make: (resources) => {
    const { db } = resources;
    const { assertSnapshotAttachments } = makeHelpers(resources);

    return {
      queries: {
        findReplyRequest: storeQuery({
          role: 'optional',
          input: replySnapshotInputSchema,
          output: Schema.Option(replyRequestSchema),
          run: ({ requestId }) => {
            const row = db.orm
              .select()
              .from(note_reply_requests)
              .where(eq(note_reply_requests.request_id, requestId))
              .get();

            if (!row) return Option.none();

            const snapshot = Schema.decodeUnknownSync(codec)(row.snapshot);

            assertSnapshotAttachments(snapshot, true);

            return Option.some(snapshot);
          }
        })
      },
      mutations: {}
    };
  }
});

export const ReplyStore = defineStore({
  name: 'study/NoteReplyStore',
  entity: { singular: 'replySnapshot', plural: 'replySnapshots' },
  make: ({ db, clock, timestampClock }) => {
    const {
      snapshot,
      readReplySnapshot,
      discardPending,
      retirePending,
      replyContext,
      attachmentDocument,
      prepareReply
    } = makeHelpers({ db, clock, timestampClock });

    /** Rejects overlapping generation while allowing completed and failed history. */
    function requireNoActiveVersion(messageId: typeof message_versions.$inferSelect.message_id) {
      const active = db.orm
        .select({ id: message_versions.id })
        .from(message_versions)
        .where(
          and(
            eq(message_versions.message_id, messageId),
            sql`${message_versions.status} IN ('pending', 'writing')`
          )
        )
        .get();

      if (active) throw new StudyError('invalid_input', 'Message already has pending work');
    }

    return {
      queries: {
        replySnapshot: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: replySnapshotSchema,
          run: readReplySnapshot
        })
      },
      mutations: {
        sealReplyAttachments: storeMutation({
          input: replySnapshotInputSchema,
          output: replySnapshotSchema,
          run: (input) => {
            const snapshot = readReplySnapshot(input);

            if (!snapshot.pendingAttachments?.length) return snapshot;

            const messages = snapshot.messages.map((message) => ({
              ...message,
              attachments: [...message.attachments]
            }));

            for (const part of snapshot.pendingAttachments) {
              const state = db.orm
                .select()
                .from(source_processing)
                .where(eq(source_processing.source_id, part.sourceId))
                .get();

              const document = attachmentDocument(state, part.sourceId);

              const message = messages.find((item) => item.messageId === part.messageId);

              if (
                !state ||
                state.revision !== part.inputRevision ||
                state.published_request_id !== part.requestId ||
                !document ||
                !message
              )
                throw new StudyError('invalid_input', 'attachment document is not ready');

              message.attachments.push({
                partId: part.partId,
                sourceId: part.sourceId,
                sourceName: part.sourceName,
                projectId: part.projectId,
                snapshotId: document.id,
                revision: part.inputRevision
              });
            }

            for (const message of messages) {
              const order = db.orm
                .select()
                .from(message_parts)
                .where(eq(message_parts.message_id, message.messageId))
                .all();

              message.attachments.sort((a, b) =>
                Number(
                  (order.find((part) => part.id === a.partId)?.ordinal ?? 0n) -
                    (order.find((part) => part.id === b.partId)?.ordinal ?? 0n)
                )
              );
            }

            const { pendingAttachments: _pending, ...rest } = snapshot;

            const sealed = { ...rest, messages };

            db.orm
              .update(note_reply_requests)
              .set({ snapshot: Schema.encodeSync(codec)(sealed) })
              .where(eq(note_reply_requests.request_id, input.requestId))
              .run();

            makeReplySourceInputs({ db, clock, timestampClock }).retain(sealed);

            return sealed;
          }
        }),
        failConversion: storeMutation({
          input: replyRequestSchema,
          output: Schema.Boolean,
          run: (input) => {
            const found = db.orm
              .select({ origin: message_versions.origin, status: message_versions.status })
              .from(message_versions)
              .innerJoin(messages, eq(messages.id, message_versions.message_id))
              .where(
                and(
                  replyTargetPredicate(input),
                  eq(message_versions.generation_request_id, input.requestId)
                )
              )
              .get();

            if (!found || found.origin !== 'convert' || found.status === 'complete') return false;

            db.orm
              .update(message_versions)
              .set({ status: 'failed' })
              .where(eq(message_versions.id, input.versionId))
              .run();

            return true;
          }
        }),
        abandonReply: storeMutation({
          input: replyRequestSchema,
          output: Schema.Boolean,
          run: (input) => {
            const request = db.orm
              .select()
              .from(note_reply_requests)
              .where(eq(note_reply_requests.request_id, input.requestId))
              .get();

            if (
              !request ||
              request.note_id !== input.noteId ||
              request.version_id !== input.versionId
            )
              return false;

            const version = db.orm
              .select()
              .from(message_versions)
              .where(eq(message_versions.id, request.version_id))
              .get();

            if (!version || version.status === 'complete') return false;

            const message = db.orm
              .select()
              .from(messages)
              .where(eq(messages.id, version.message_id))
              .get();

            assertAbandonTarget();

            function assertAbandonTarget() {
              if (
                !message ||
                message.note_id !== request!.note_id ||
                message.id !== input.messageId ||
                !generationMatches(
                  version!,
                  Schema.decodeUnknownSync(codec)(request!.snapshot),
                  message.role
                )
              )
                throw new StudyError('invalid_input', 'invalid reply target');
            }

            discardPending(message!, version);

            return true;
          }
        }),
        publishReply: storeMutation({
          input: Schema.Struct({
            ...publishReplyInputSchema.fields,
            language: runPreferencesSchema.fields.language
          }),
          output: versionIdSchema,
          run: (input) => {
            const invalid = (): never => {
              throw new StudyError('invalid_input', 'invalid reply publication');
            };

            function assertCitation(
              citation: (typeof input.citations)[number],
              markers: Set<number>
            ) {
              if (
                !Number.isInteger(citation.marker) ||
                citation.marker < 1 ||
                citation.marker > 4294967295 ||
                markers.has(citation.marker) ||
                !Number.isSafeInteger(citation.blockOrdinal) ||
                citation.blockOrdinal < 0 ||
                !citation.quote.trim()
              )
                invalid();
            }

            const { row, result: snapshot, note, target, version } = replyContext(input.requestId);

            validatePublicationInput();

            function validatePublicationInput() {
              if (!input.text.trim() || [...input.text].length > 100_000) invalid();

              if (allowsLiteralReferences(snapshot, note?.mode)) {
                if (input.citations.length) invalid();

                return;
              }

              const markers = new Set<number>();

              for (const citation of input.citations) {
                assertCitation(citation, markers);

                markers.add(citation.marker);
              }

              const references = new Set(
                Array.from(input.text.matchAll(/\[(\d+)\]/g), (match) => Number(match[1]))
              );

              if (
                references.size !== markers.size ||
                [...references].some((marker) => !markers.has(marker))
              )
                invalid();
            }

            assertPublicationIdentity();

            function assertPublicationIdentity() {
              if (
                !note ||
                !matchesRequest(snapshot, row) ||
                target?.note_id !== note.id ||
                version?.message_id !== target.id ||
                !generationMatches(version, snapshot, target.role)
              )
                invalid();
            }

            const payload = JSON.stringify(
              { requestId: input.requestId, text: input.text, citations: input.citations },
              (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
            );

            const saved = Schema.decodeUnknownSync(persistedCodec)(row.snapshot);
            const publishedText = answerPublicationText(snapshot, input);

            function selectedCitation(
              citation: (typeof publishReplyInputSchema.Type.citations)[number]
            ) {
              const selected = snapshot.context?.inputs.find(
                (item) =>
                  citation.input !== undefined &&
                  selectionReferenceKey(item.input) === selectionReferenceKey(citation.input) &&
                  item.snapshotId === citation.documentId
              );

              const range = citation.selectedRange;

              if (!selected || !range || selected.snapshotId !== citation.documentId)
                return invalid();

              const excerpt = citationExcerpt(selected, citation);

              const document = db.orm
                .select()
                .from(content_snapshots)
                .where(eq(content_snapshots.id, citation.documentId))
                .get();

              if (
                !excerpt ||
                !document ||
                citation.sourceId !== selectedCitationIdentity(selected.input).source_id
              )
                return invalid();

              return {
                version_id: row.version_id,
                marker: BigInt(citation.marker),
                ...selectedCitationIdentity(selected.input),
                document_id: selected.snapshotId,
                block_id: excerpt.blockId,
                range_start: BigInt(excerpt.start),
                range_end: BigInt(excerpt.end),
                source_name: selected.name,
                anchor: JSON.stringify(excerpt.anchor),
                quote: citation.quote
              };
            }

            function attachmentCitation(
              citation: (typeof publishReplyInputSchema.Type.citations)[number]
            ) {
              if (
                citation.input.kind !== 'source' ||
                citation.sourceId !== citation.input.sourceId ||
                citation.sourceId === null ||
                citation.selectedRange !== undefined
              )
                return invalid();

              const attachment = snapshot.messages
                .flatMap((message) => message.attachments)
                .find(
                  (part) =>
                    part.sourceId === citation.sourceId &&
                    part.snapshotId === citation.documentId &&
                    citation.input.kind === 'source' &&
                    part.revision === citation.input.revision &&
                    part.snapshotId === citation.input.snapshotId
                );

              const source = db.orm
                .select()
                .from(sources)
                .where(and(eq(sources.id, citation.sourceId)))
                .get();

              const document = db.orm
                .select()
                .from(content_snapshots)
                .where(
                  and(
                    eq(content_snapshots.id, citation.documentId),
                    eq(content_snapshots.source_id, citation.sourceId)
                  )
                )
                .get();

              const block = db.orm
                .select()
                .from(blocks)
                .where(
                  and(
                    eq(blocks.document_id, citation.documentId),
                    eq(blocks.ordinal, BigInt(citation.blockOrdinal))
                  )
                )
                .get();

              if (
                !attachment ||
                !source ||
                !document ||
                !block ||
                !block.text.includes(citation.quote)
              )
                return invalid();

              const anchor = Schema.decodeUnknownSync(anchorSchema)(JSON.parse(block.anchor));

              return {
                version_id: row.version_id,
                marker: BigInt(citation.marker),
                source_id: citation.sourceId,
                authored_version_id: null,
                source_revision: attachment.revision,
                document_id: citation.documentId,
                block_id: block.editing_id,
                range_start: null,
                range_end: null,
                source_name: attachment.sourceName,
                anchor: JSON.stringify(anchor),
                quote: citation.quote
              };
            }

            const validated = input.citations.map((citation) =>
              citation.selectedRange !== undefined
                ? selectedCitation(citation)
                : attachmentCitation(citation)
            );

            function assertPublicationAttachments() {
              for (const item of snapshot.messages.flatMap((message) => message.attachments)) {
                if (
                  !db.orm
                    .select()
                    .from(sources)
                    .where(and(eq(sources.id, item.sourceId)))
                    .get() ||
                  !db.orm
                    .select()
                    .from(content_snapshots)
                    .where(
                      and(
                        eq(content_snapshots.id, item.snapshotId),
                        eq(content_snapshots.source_id, item.sourceId)
                      )
                    )
                    .get()
                )
                  invalid();
              }
            }

            function assertPublicationReplay() {
              const existing = db.orm
                .select()
                .from(citations)
                .where(eq(citations.version_id, row.version_id))
                .orderBy(asc(citations.marker))
                .all();

              const expected = [...validated].sort((a, b) => Number(a.marker - b.marker));

              if (
                saved.publication !== payload ||
                version!.text !== (saved.publicationText ?? input.text) ||
                existing.length !== expected.length ||
                existing.some((item, i) => !sameReceiptCitation(item, expected[i]!))
              )
                invalid();
            }

            if (version!.status === 'complete') {
              assertPublicationReplay();

              return row.version_id;
            }

            assertPendingPublication();

            /** Fences publication against unresolved attachments and changes to the captured selection. */
            function assertPendingPublication() {
              if (
                (snapshot.pendingAttachments?.length ?? 0) > 0 ||
                [...publishedText].length > 100_000
              )
                invalid();

              if (
                version!.status !== 'pending' ||
                !replyVersionSelection(target!, version!, snapshot) ||
                !replyContextMatches(snapshot, note!)
              )
                invalid();
            }

            assertPublicationAttachments();

            db.orm
              .update(message_versions)
              .set({ text: publishedText, status: 'complete' })
              .where(eq(message_versions.id, row.version_id))
              .run();

            selectCompletedAnswer();

            /** Selects completed answers and conversions only when their selection policy permits it. */
            function selectCompletedAnswer() {
              if (
                snapshot.generation?.questionVersionId ||
                (snapshot.generation?.conversion &&
                  target!.active_version_id === snapshot.generation.conversion.baseVersionId)
              )
                db.orm
                  .update(messages)
                  .set({ active_version_id: row.version_id })
                  .where(eq(messages.id, target!.id))
                  .run();
            }

            for (const citation of validated) db.orm.insert(citations).values(citation).run();

            db.orm
              .update(note_reply_requests)
              .set({
                snapshot: Schema.encodeSync(persistedCodec)({
                  ...saved,
                  publication: payload,
                  publicationText: publishedText
                })
              })
              .where(eq(note_reply_requests.request_id, row.request_id))
              .run();
            db.orm
              .update(notes)
              .set({
                updated_at: unixSeconds(timestampClock),
                context_revision: sql`${notes.context_revision} + 1`
              })
              .where(eq(notes.id, note!.id))
              .run();

            return row.version_id;
          }
        }),
        prepareReply: storeMutation({
          input: replyRequestInputSchema,
          output: Schema.Void,
          run: prepareReply
        }),
        retireTargetPending: storeMutation({
          input: reanswerInputSchema,
          output: Schema.Void,
          run: ({ messageId }) => {
            const message = db.orm.select().from(messages).where(eq(messages.id, messageId)).get();

            if (!message) throw new StudyError('not_found', 'message not found');

            retirePending(message, true);
          }
        }),
        requestConversion: storeMutation({
          input: convertMessageInputSchema,
          output: Schema.Struct({ ...replyRequestSchema.fields, created: Schema.Boolean }),
          run: (input) => {
            /** Fence both new requests and failed retries against the active base version. */
            function requireCurrentTarget() {
              const message = db.orm
                .select()
                .from(messages)
                .where(eq(messages.id, input.messageId))
                .get();

              if (
                !message ||
                message.role !== 'user' ||
                message.active_version_id !== input.expectedActiveVersionId
              )
                throw new StudyError('invalid_input', 'Conversion target changed');

              return message;
            }

            const existing = db.orm
              .select()
              .from(note_reply_requests)
              .innerJoin(message_versions, eq(message_versions.id, note_reply_requests.version_id))
              .where(
                and(
                  eq(message_versions.message_id, input.messageId),
                  eq(message_versions.based_on, input.expectedActiveVersionId),
                  eq(message_versions.origin, 'convert')
                )
              )
              .all();

            for (const row of existing) {
              const saved = Schema.decodeUnknownSync(codec)(row.note_reply_requests.snapshot);

              if (saved.generation?.conversion?.strategyId === input.strategyId) {
                const retry = row.message_versions.status === 'failed';

                if (retry) {
                  requireCurrentTarget();
                  requireNoActiveVersion(input.messageId);
                  db.orm
                    .update(message_versions)
                    .set({ status: 'pending' })
                    .where(eq(message_versions.id, saved.versionId))
                    .run();
                }

                return {
                  requestId: saved.requestId,
                  noteId: saved.noteId,
                  messageId: saved.messageId,
                  versionId: saved.versionId,
                  created: retry
                };
              }
            }

            const message = requireCurrentTarget();

            requireNoActiveVersion(input.messageId);

            const result = snapshot(
              { noteId: message.note_id, requestId: crypto.randomUUID() },
              {
                messageId: message.id,
                origin: 'convert',
                instruction: null,
                conversion: {
                  strategyId: input.strategyId,
                  baseVersionId: input.expectedActiveVersionId
                }
              }
            );

            return { ...result, created: true };
          }
        }),
        requestTarget: storeMutation({
          input: Schema.Struct({
            ...rewriteMessageInputSchema.fields,
            origin: Schema.Literals(['answer', 'improve', 'summarize', 'instruction']),
            requestId: Schema.String,
            context: Schema.optional(runSelectionContextSchema)
          }),
          output: replyRequestSchema,
          run: (input) => {
            const message = db.orm
              .select()
              .from(messages)
              .where(eq(messages.id, input.messageId))
              .get();

            if (!message) throw new StudyError('not_found', 'message not found');

            const instruction = input.instruction?.trim() || null;

            if (input.origin === 'instruction' && instruction === null)
              throw new StudyError('invalid_input', 'invalid instruction');

            retirePending(message, true);

            return snapshot(
              { noteId: message.note_id, requestId: input.requestId, context: input.context },
              {
                messageId: message.id,
                origin: input.origin,
                instruction
              }
            );
          }
        }),
        requestQuestionReply: storeMutation({
          input: requestInput,
          output: replyRequestSchema,
          run: (input) => {
            if (!input.context || input.context.messages.at(-1)?.role !== 'user')
              throw new StudyError('invalid_input', 'Question requires a captured user target');

            const question = input.context.messages.at(-1)!;

            return snapshot(input, {
              messageId: question.messageId,
              origin: 'answer',
              instruction: null,
              questionVersionId: question.versionId
            });
          }
        }),
        requestReply: storeMutation({
          input: requestInput,
          output: replyRequestSchema,
          run: (input) => {
            prepareReply(input);

            return snapshot(input);
          }
        })
      }
    };
  }
});

export const ReplyReadinessStore = defineStore({
  name: 'study/NoteReplyReadinessStore',
  entity: { singular: 'replyReadiness', plural: 'replyReadinesses' },
  make: ({ db, clock, timestampClock }) => {
    const { readReplySnapshot } = makeHelpers({ db, clock, timestampClock });

    return {
      queries: {
        replyReadiness: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: Schema.Array(pendingReplyAttachmentSchema),
          run: (input) => {
            const snapshot = readReplySnapshot(input);

            return (snapshot.pendingAttachments ?? []).filter((part) => {
              const state = db.orm
                .select()
                .from(source_processing)
                .where(eq(source_processing.source_id, part.sourceId))
                .get();

              return !state?.document_id || state.published_request_id !== part.requestId;
            });
          }
        })
      },
      mutations: {}
    };
  }
});

export const ReplyWakeStore = defineStore({
  name: 'study/NoteReplyWakeStore',
  entity: { singular: 'replyWake', plural: 'replyWakes' },
  make: ({ db }) => {
    return {
      queries: {
        replyWakes: storeQuery({
          role: 'collection',
          input: Schema.Struct({
            sourceId: sourceIdSchema,
            after: Schema.optional(Schema.String),
            limit: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(100))
          }),
          output: Schema.Array(
            Schema.Struct({
              requestId: Schema.String,
              executionId: Schema.String,
              event: noteGenerationRequestedSchema,
              pendingAttachments: Schema.Array(pendingReplyAttachmentSchema)
            })
          ),
          run: (input) => {
            const rows = db.orm
              .select({
                request: note_reply_requests,
                event: workflowEvents,
                receipt: workflowReceipts
              })
              .from(note_reply_requests)
              .innerJoin(
                workflowEvents,
                and(
                  eq(workflowEvents.type, 'NoteGenerationRequested'),
                  eq(workflowEvents.correlationId, note_reply_requests.request_id)
                )
              )
              .innerJoin(
                workflowReceipts,
                and(
                  eq(workflowReceipts.eventId, workflowEvents.eventId),
                  eq(workflowReceipts.subscription, 'conversation-reply'),
                  eq(workflowReceipts.workflowVersion, 1),
                  eq(workflowReceipts.inputVersion, workflowEvents.inputVersion)
                )
              )
              .where(
                and(
                  input.after ? sql`${note_reply_requests.request_id} > ${input.after}` : sql`1`,
                  sql`json_array_length(${note_reply_requests.snapshot}, '$.pendingAttachments') > 0`,
                  sql`(EXISTS (SELECT 1 FROM json_each(${note_reply_requests.snapshot}, '$.pendingAttachments') AS pending WHERE json_extract(pending.value, '$.sourceId') = ${String(input.sourceId)}) OR EXISTS (SELECT 1 FROM json_each(${note_reply_requests.snapshot}, '$.messages') AS captured JOIN json_each(captured.value, '$.attachments') AS attachment WHERE json_extract(attachment.value, '$.sourceId') = ${String(input.sourceId)}))`
                )
              )
              .orderBy(asc(note_reply_requests.request_id))
              .limit(input.limit)
              .all();

            return rows.map(({ request, event, receipt }) => {
              const decoded = decodeEvent(event.payload);

              if (
                decoded.type !== 'NoteGenerationRequested' ||
                decoded.requestId !== request.request_id ||
                decoded.noteId !== request.note_id ||
                decoded.versionId !== request.version_id
              )
                throw new StudyError('invalid_input', 'reply event identity mismatch');

              return {
                requestId: request.request_id,
                executionId: receipt.executionId,
                event: decoded,
                pendingAttachments:
                  Schema.decodeUnknownSync(codec)(request.snapshot).pendingAttachments ?? []
              };
            });
          }
        })
      },
      mutations: {}
    };
  }
});

function matchesRequest(
  snapshot: typeof replySnapshotSchema.Type,
  row: typeof note_reply_requests.$inferSelect
) {
  return (
    snapshot.requestId === row.request_id &&
    snapshot.noteId === row.note_id &&
    snapshot.versionId === row.version_id
  );
}

function generationMatches(
  version: typeof message_versions.$inferSelect,
  snapshot: typeof replySnapshotSchema.Type,
  role: typeof messages.$inferSelect.role
) {
  return (
    validAnswerGeneration(version, snapshot, role) &&
    version.origin === (snapshot.generation?.origin ?? 'answer') &&
    version.instruction ===
      (snapshot.generation?.origin === 'instruction' ? snapshot.generation.instruction : null)
  );
}

function validAnswerGeneration(
  version: typeof message_versions.$inferSelect,
  snapshot: typeof replySnapshotSchema.Type,
  role: typeof messages.$inferSelect.role
) {
  if (version.origin !== 'answer' || role === 'assistant') return true;

  return role === 'user' && version.based_on === snapshot.generation?.questionVersionId;
}

function isAnswerTarget(
  message: typeof messages.$inferSelect | undefined,
  questionVersionId?: typeof versionIdSchema.Type
) {
  if (!message) return false;

  if (questionVersionId)
    return message.role === 'user' && message.active_version_id === questionVersionId;

  return message.role === 'assistant' && message.reply_to !== null;
}

function answerPublicationText(
  snapshot: typeof replySnapshotSchema.Type,
  input: typeof publishReplyInputSchema.Type & {
    language?: typeof runPreferencesSchema.Type.language;
  }
) {
  if (!snapshot.generation?.questionVersionId) return input.text;

  const language = snapshot.context?.preferences.language ?? input.language ?? 'english';

  return `**${text(language, 'NoteQuestion')}**\n\n${snapshot.messages.at(-1)!.text}\n\n**${text(language, 'NoteAnswer')}**\n\n${input.text}`;
}

/** Questions and conversions retain their original selection until publication. */
function keepsOriginalSelection(
  target: { questionVersionId?: unknown; conversion?: unknown } | undefined
) {
  return (
    target !== undefined &&
    (target.questionVersionId !== undefined || target.conversion !== undefined)
  );
}

/** Exact conversions survive unrelated edits while noteal captures stay fenced. */
function replyContextMatches(
  snapshot: typeof replySnapshotSchema.Type,
  note: typeof notes.$inferSelect
) {
  return (
    snapshot.context !== undefined ||
    snapshot.generation?.conversion !== undefined ||
    note.context_revision === snapshot.contextRevision
  );
}

/** Matches either the captured conversion parent or the expected reply selection. */
function replyVersionSelection(
  target: typeof messages.$inferSelect,
  version: typeof message_versions.$inferSelect,
  snapshot: typeof replySnapshotSchema.Type
) {
  if (snapshot.generation?.conversion)
    return version.based_on === snapshot.generation.conversion.baseVersionId;

  return (
    target.active_version_id === (snapshot.generation?.questionVersionId ?? snapshot.versionId)
  );
}

/** Requires an active generation version that still belongs to the captured note and selection. */
function replySelectionMatches(
  target: typeof messages.$inferSelect | undefined,
  version: typeof message_versions.$inferSelect | undefined,
  result: typeof replySnapshotSchema.Type
) {
  if (!target || !version) return false;

  return (
    target.note_id === result.noteId &&
    version.message_id === result.messageId &&
    (version.status === 'pending' || version.status === 'writing') &&
    replyVersionSelection(target, version, result)
  );
}

/** Ungrounded chat and faithful conversions preserve bracketed text without invented citations. */
function allowsLiteralReferences(
  snapshot: typeof replySnapshotSchema.Type,
  mode: NoteMode | undefined
) {
  return mode === NoteMode.Assistant || snapshot.generation?.conversion !== undefined;
}
