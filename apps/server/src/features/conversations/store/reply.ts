import type { reanswerInputSchema } from '@study/contracts/conversations/schemas';
import {
  anchorSchema,
  publishReplyInputSchema,
  replyRequestInputSchema,
  replyRequestSchema,
  rewriteMessageInputSchema,
  replySnapshotInputSchema,
  replySnapshotSchema,
  pendingReplyAttachmentSchema
} from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { conversationGenerationRequestedSchema } from '@study/contracts/events';
import { sourceIdSchema } from '@study/contracts/ids';
import { versionIdSchema } from '@study/contracts/ids';
import { and, asc, desc, eq, sql } from '@study/db';
import {
  blocks,
  citations,
  conversation_reply_requests,
  documents,
  message_parts,
  message_versions,
  messages,
  sessions,
  source_processing,
  sources,
  workflowEvents,
  workflowReceipts
} from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';
import { decodeEvent } from '#server/platform/workflows/events';

import { makeHistory } from './history.ts';
import { makePersistence } from './persistence.ts';
import { makeThread } from './thread.ts';

const codec = Schema.fromJsonString(Schema.toCodecJson(replySnapshotSchema));

const persistedCodec = Schema.fromJsonString(
  Schema.toCodecJson(
    Schema.Struct({ ...replySnapshotSchema.fields, publication: Schema.optional(Schema.String) })
  )
);

const requestInput = Schema.Struct({ ...replyRequestInputSchema.fields, requestId: Schema.String });

function makeHelpers({ db, clock }: StoreResources) {
  const { insertSelectedVersion } = makePersistence({ db, clock });
  const { conversationHistory, conversationRoot } = makeHistory({ db, clock });
  const { assertThreadRoot } = makeThread({ db, clock });

  function snapshot(
    input: typeof requestInput.Type,
    target?: {
      messageId: typeof reanswerInputSchema.Type.messageId;
      origin: 'answer' | 'improve' | 'summarize' | 'instruction';
      instruction: string | null;
    }
  ) {
    const foundSession = db.orm
      .select()
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .get();

    if (!foundSession) throw new StudyError('not_found', 'session not found');

    const session = foundSession;

    let totalAttachments = 0;
    const existing =
      target && db.orm.select().from(messages).where(eq(messages.id, target.messageId)).get();

    const threadRoot = existing?.thread_root ?? input.threadRoot;

    if (threadRoot != null) assertThreadRoot(session.id, threadRoot);

    const captured = captureConversation();

    function captureConversation() {
      let captured = conversationHistory(session.id, target?.messageId, threadRoot ?? undefined);

      assertSnapshotTarget();

      captured = targetHistory(captured);

      if (threadRoot != null && !target && captured.at(-1)?.role !== 'user')
        throw new StudyError('invalid_input', 'reply target must be a user message');

      return captureThread(captured);
    }

    function assertSnapshotTarget() {
      if (target && (!existing || existing.session_id !== session.id))
        throw new StudyError('not_found', 'message not found');

      if (
        target?.origin === 'answer' &&
        (existing?.role !== 'assistant' || existing.reply_to === null)
      )
        throw new StudyError('invalid_input', 'reanswer target must be an assistant reply');
    }

    function targetHistory(captured: ReturnType<typeof conversationHistory>) {
      if (target) {
        const index = captured.findIndex((item) => item.messageId === target.messageId);

        if (index < 0)
          throw new StudyError('invalid_input', 'target is outside conversation context');

        captured = captured.slice(0, target.origin === 'answer' ? index : index + 1);

        if (target.origin === 'answer' && captured.at(-1)?.messageId !== existing!.reply_to)
          throw new StudyError('invalid_input', 'reply context is unavailable');
      }

      return captured;
    }

    function captureThread(captured: ReturnType<typeof conversationHistory>) {
      if (threadRoot != null) {
        const rootPart = db.orm
          .select()
          .from(message_parts)
          .where(eq(message_parts.id, threadRoot))
          .get();

        if (!rootPart) throw new StudyError('invalid_input', 'invalid thread root');

        const root = conversationRoot(session.id, rootPart.message_id);
        let total = root.text.length + captured.reduce((sum, item) => sum + item.text.length, 0);

        while (total > 200_000 && captured.length > 1) total -= captured.shift()!.text.length;

        if (total > 200_000)
          throw new StudyError('invalid_input', 'thread exceeds conversation context limit');

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

      if (!source || source.project_id !== session.project_id)
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

      if (!document || processing?.published_request_id !== processing?.request_id) {
        if (!processing)
          throw new StudyError('invalid_input', 'attachment processing is unavailable');

        pendingAttachments.push({
          messageId,
          partId: part.id,
          sourceId: source.id,
          sourceName: part.source_name,
          projectId: session.project_id,
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
          documentId: document.id,
          projectId: session.project_id
        }
      ];
    }

    const history = captured.map((message) => {
      const parts = db.orm
        .select()
        .from(message_parts)
        .where(eq(message_parts.message_id, message.messageId))
        .orderBy(asc(message_parts.ordinal))
        .limit(21)
        .all();

      totalAttachments += parts.length;

      if (parts.length > 20 || totalAttachments > 50)
        throw new StudyError('invalid_input', 'reply context has too many attachments');

      const selectedParts =
        threadRoot != null && message === captured[0]
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

    function createPendingReply() {
      const now = unixSeconds(clock);
      const message =
        existing ??
        db.orm
          .insert(messages)
          .values({
            session_id: session.id,
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
      const version = insertSelectedVersion({
        message_id: message.id,
        number: (previous?.number ?? 0n) + 1n,
        ...generationFields(),
        status: 'pending',
        text: '',
        created_at: now
      });

      return { now, message, version };
    }

    const result = {
      requestId: input.requestId,
      sessionId: session.id,
      projectId: session.project_id,
      messageId: message.id,
      versionId: version.id,
      contextRevision: session.context_revision,
      generation: target ? { origin: target.origin, instruction: target.instruction } : undefined,
      messages: history,
      ...(pendingAttachments.length ? { pendingAttachments } : {})
    };

    db.orm
      .insert(conversation_reply_requests)
      .values({
        request_id: input.requestId,
        session_id: session.id,
        version_id: version.id,
        snapshot: Schema.encodeSync(codec)(result)
      })
      .run();
    db.orm.update(sessions).set({ updated_at: now }).where(eq(sessions.id, session.id)).run();

    return result;
  }

  function attachmentSource(part: {
    sourceId: typeof sources.$inferSelect.id;
    projectId: typeof sources.$inferSelect.project_id;
  }) {
    return db.orm
      .select()
      .from(sources)
      .where(and(eq(sources.id, part.sourceId), eq(sources.project_id, part.projectId!)))
      .get();
  }

  function attachmentDocument(
    processing: typeof source_processing.$inferSelect | undefined,
    sourceId: typeof sources.$inferSelect.id
  ) {
    if (processing?.document_id == null) return undefined;

    return db.orm
      .select()
      .from(documents)
      .where(and(eq(documents.id, processing.document_id), eq(documents.source_id, sourceId)))
      .get();
  }

  function replyContext(requestId: string) {
    const row = db.orm
      .select()
      .from(conversation_reply_requests)
      .where(eq(conversation_reply_requests.request_id, requestId))
      .get();

    if (!row) throw new StudyError('not_found', 'reply request not found');

    const result = Schema.decodeUnknownSync(codec)(row.snapshot);
    const session = db.orm.select().from(sessions).where(eq(sessions.id, row.session_id)).get();
    const target = db.orm.select().from(messages).where(eq(messages.id, result.messageId)).get();
    const version = db.orm
      .select()
      .from(message_versions)
      .where(eq(message_versions.id, row.version_id))
      .get();

    return { row, result, session, target, version };
  }

  function readReplySnapshot(input: typeof replySnapshotInputSchema.Type) {
    const { row, result, session, target, version } = replyContext(input.requestId);

    if (
      !session ||
      !matchesRequest(result, row) ||
      session.project_id !== result.projectId ||
      session.context_revision !== result.contextRevision ||
      !replySelectionMatches(target, version, result)
    )
      throw new StudyError('invalid_input', 'reply request is stale');

    assertSnapshotAttachments(result);

    return result;
  }

  function assertSnapshotAttachments(result: typeof replySnapshotSchema.Type) {
    for (const item of result.messages)
      for (const part of item.attachments) {
        const document = db.orm
          .select()
          .from(documents)
          .where(and(eq(documents.id, part.documentId), eq(documents.source_id, part.sourceId)))
          .get();
        const source = attachmentSource(part);

        if (!document || !source)
          throw new StudyError('invalid_input', 'captured attachment is unavailable');
      }

    assertPendingAttachments(result.pendingAttachments ?? []);
  }

  function assertPendingAttachments(parts: readonly (typeof pendingReplyAttachmentSchema.Type)[]) {
    for (const part of parts) {
      const source = attachmentSource(part);
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

  function discardPending(
    message: typeof messages.$inferSelect,
    version: typeof message_versions.$inferSelect
  ) {
    const completed =
      (version.based_on === null
        ? undefined
        : db.orm
            .select()
            .from(message_versions)
            .where(
              and(
                eq(message_versions.id, version.based_on),
                eq(message_versions.message_id, message.id),
                eq(message_versions.status, 'complete')
              )
            )
            .get()) ??
      db.orm
        .select()
        .from(message_versions)
        .where(
          and(eq(message_versions.message_id, message.id), eq(message_versions.status, 'complete'))
        )
        .orderBy(desc(message_versions.number))
        .get();

    if (completed) {
      if (message.active_version_id === version.id)
        db.orm
          .update(messages)
          .set({ active_version_id: completed.id })
          .where(eq(messages.id, message.id))
          .run();

      db.orm.delete(message_versions).where(eq(message_versions.id, version.id)).run();
    } else db.orm.delete(messages).where(eq(messages.id, message.id)).run();
  }

  return { snapshot, readReplySnapshot, discardPending, replyContext, attachmentDocument };
}

export const ReplyStore = defineStore({
  name: 'study/ConversationReplyStore',
  entity: { singular: 'replySnapshot', plural: 'replySnapshots' },
  make: ({ db, clock }) => {
    const { snapshot, readReplySnapshot, discardPending, replyContext, attachmentDocument } =
      makeHelpers({ db, clock });

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

              if (!state || state.published_request_id !== part.requestId || !document || !message)
                throw new StudyError('invalid_input', 'attachment document is not ready');

              message.attachments.push({
                partId: part.partId,
                sourceId: part.sourceId,
                sourceName: part.sourceName,
                projectId: part.projectId,
                documentId: document.id
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
              .update(conversation_reply_requests)
              .set({ snapshot: Schema.encodeSync(codec)(sealed) })
              .where(eq(conversation_reply_requests.request_id, input.requestId))
              .run();

            return sealed;
          }
        }),
        abandonReply: storeMutation({
          input: replyRequestSchema,
          output: Schema.Boolean,
          run: (input) => {
            const request = db.orm
              .select()
              .from(conversation_reply_requests)
              .where(eq(conversation_reply_requests.request_id, input.requestId))
              .get();

            if (
              !request ||
              request.session_id !== input.sessionId ||
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
                message.session_id !== request!.session_id ||
                message.id !== input.messageId ||
                (version!.origin === 'answer' && message.role !== 'assistant')
              )
                throw new StudyError('invalid_input', 'invalid reply target');
            }

            discardPending(message!, version);

            return true;
          }
        }),
        publishReply: storeMutation({
          input: publishReplyInputSchema,
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

            validatePublicationInput();

            function validatePublicationInput() {
              if (!input.text.trim() || [...input.text].length > 100_000) invalid();

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

            const {
              row,
              result: snapshot,
              session,
              target,
              version
            } = replyContext(input.requestId);

            assertPublicationIdentity();

            function assertPublicationIdentity() {
              if (
                !session ||
                !matchesRequest(snapshot, row) ||
                session.project_id !== snapshot.projectId ||
                target?.session_id !== session.id ||
                version?.message_id !== target.id ||
                !generationMatches(version, snapshot, target.role)
              )
                invalid();
            }

            const payload = JSON.stringify(input, (_key, value) =>
              typeof value === 'bigint' ? value.toString() : value
            );
            const saved = Schema.decodeUnknownSync(persistedCodec)(row.snapshot);
            const validated = input.citations.map((citation) => {
              const attachment = snapshot.messages
                .flatMap((message) => message.attachments)
                .find(
                  (part) =>
                    part.sourceId === citation.sourceId &&
                    part.documentId === citation.documentId &&
                    part.projectId === session!.project_id
                );
              const source = db.orm
                .select()
                .from(sources)
                .where(
                  and(
                    eq(sources.id, citation.sourceId),
                    eq(sources.project_id, session!.project_id)
                  )
                )
                .get();
              const document = db.orm
                .select()
                .from(documents)
                .where(
                  and(
                    eq(documents.id, citation.documentId),
                    eq(documents.source_id, citation.sourceId)
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
                source_name: attachment.sourceName,
                anchor: JSON.stringify(anchor),
                quote: citation.quote
              };
            });

            function assertPublicationAttachments() {
              for (const item of snapshot.messages.flatMap((message) => message.attachments)) {
                if (
                  !db.orm
                    .select()
                    .from(sources)
                    .where(
                      and(
                        eq(sources.id, item.sourceId),
                        eq(sources.project_id, session!.project_id)
                      )
                    )
                    .get() ||
                  !db.orm
                    .select()
                    .from(documents)
                    .where(
                      and(eq(documents.id, item.documentId), eq(documents.source_id, item.sourceId))
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
                version!.text !== input.text ||
                existing.length !== expected.length ||
                existing.some((item, i) => {
                  const wanted = expected[i]!;

                  return (
                    item.marker !== wanted.marker ||
                    item.source_id !== wanted.source_id ||
                    item.source_name !== wanted.source_name ||
                    item.anchor !== wanted.anchor ||
                    item.quote !== wanted.quote
                  );
                })
              )
                invalid();
            }

            if (version!.status === 'complete') {
              assertPublicationReplay();

              return row.version_id;
            }

            if ((snapshot.pendingAttachments?.length ?? 0) > 0) invalid();

            if (
              version!.status !== 'pending' ||
              target!.active_version_id !== row.version_id ||
              session!.context_revision !== snapshot.contextRevision
            )
              invalid();

            assertPublicationAttachments();

            db.orm
              .update(message_versions)
              .set({ text: input.text, status: 'complete' })
              .where(eq(message_versions.id, row.version_id))
              .run();

            for (const citation of validated) db.orm.insert(citations).values(citation).run();

            db.orm
              .update(conversation_reply_requests)
              .set({
                snapshot: Schema.encodeSync(persistedCodec)({ ...saved, publication: payload })
              })
              .where(eq(conversation_reply_requests.request_id, row.request_id))
              .run();
            db.orm
              .update(sessions)
              .set({
                updated_at: unixSeconds(clock),
                context_revision: sql`${sessions.context_revision} + 1`
              })
              .where(eq(sessions.id, session!.id))
              .run();

            return row.version_id;
          }
        }),
        requestTarget: storeMutation({
          input: Schema.Struct({
            ...rewriteMessageInputSchema.fields,
            origin: Schema.Literals(['answer', 'improve', 'summarize', 'instruction']),
            requestId: Schema.String
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

            const pending = db.orm
              .select()
              .from(message_versions)
              .where(
                and(
                  eq(message_versions.message_id, message.id),
                  sql`${message_versions.status} != 'complete'`
                )
              )
              .all();

            for (const version of pending) discardPending(message, version);

            return snapshot(
              { sessionId: message.session_id, requestId: input.requestId },
              {
                messageId: message.id,
                origin: input.origin,
                instruction
              }
            );
          }
        }),
        requestReply: storeMutation({
          input: requestInput,
          output: replyRequestSchema,
          run: (input) => {
            const pending = db.orm
              .select({ message: messages, version: message_versions })
              .from(messages)
              .innerJoin(message_versions, eq(message_versions.message_id, messages.id))
              .where(
                and(
                  eq(messages.session_id, input.sessionId),
                  sql`${message_versions.status} != 'complete'`
                )
              )
              .limit(101)
              .all();

            if (pending.length > 100)
              throw new StudyError('invalid_input', 'too many pending versions');

            let activeRequest = false;

            for (const item of pending) {
              const request = db.orm
                .select()
                .from(conversation_reply_requests)
                .where(eq(conversation_reply_requests.version_id, item.version.id))
                .get();

              if (!request) {
                activeRequest = true;
                continue;
              }

              try {
                readReplySnapshot({ requestId: request.request_id });
                activeRequest = true;
              } catch (error) {
                if (
                  !(error instanceof StudyError) ||
                  !['invalid_input', 'not_found'].includes(error.kind)
                )
                  throw error;

                discardPending(item.message, item.version);
              }
            }

            if (activeRequest)
              throw new StudyError('invalid_input', 'conversation already has a pending version');

            return snapshot(input);
          }
        })
      }
    };
  }
});

export const ReplyReadinessStore = defineStore({
  name: 'study/ConversationReplyReadinessStore',
  entity: { singular: 'replyReadiness', plural: 'replyReadinesses' },
  make: ({ db, clock }) => {
    const { readReplySnapshot } = makeHelpers({ db, clock });

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
  name: 'study/ConversationReplyWakeStore',
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
              event: conversationGenerationRequestedSchema,
              pendingAttachments: Schema.Array(pendingReplyAttachmentSchema)
            })
          ),
          run: (input) => {
            const rows = db.orm
              .select({
                request: conversation_reply_requests,
                event: workflowEvents,
                receipt: workflowReceipts
              })
              .from(conversation_reply_requests)
              .innerJoin(
                workflowEvents,
                and(
                  eq(workflowEvents.type, 'ConversationGenerationRequested'),
                  eq(workflowEvents.correlationId, conversation_reply_requests.request_id)
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
                  input.after
                    ? sql`${conversation_reply_requests.request_id} > ${input.after}`
                    : sql`1`,
                  sql`json_array_length(${conversation_reply_requests.snapshot}, '$.pendingAttachments') > 0`,
                  sql`(EXISTS (SELECT 1 FROM json_each(${conversation_reply_requests.snapshot}, '$.pendingAttachments') AS pending WHERE json_extract(pending.value, '$.sourceId') = ${String(input.sourceId)}) OR EXISTS (SELECT 1 FROM json_each(${conversation_reply_requests.snapshot}, '$.messages') AS captured JOIN json_each(captured.value, '$.attachments') AS attachment WHERE json_extract(attachment.value, '$.sourceId') = ${String(input.sourceId)}))`
                )
              )
              .orderBy(asc(conversation_reply_requests.request_id))
              .limit(input.limit)
              .all();

            return rows.map(({ request, event, receipt }) => {
              const decoded = decodeEvent(event.payload);

              if (
                decoded.type !== 'ConversationGenerationRequested' ||
                decoded.requestId !== request.request_id ||
                decoded.sessionId !== request.session_id ||
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
  row: typeof conversation_reply_requests.$inferSelect
) {
  return (
    snapshot.requestId === row.request_id &&
    snapshot.sessionId === row.session_id &&
    snapshot.versionId === row.version_id
  );
}

function generationMatches(
  version: typeof message_versions.$inferSelect,
  snapshot: typeof replySnapshotSchema.Type,
  role: typeof messages.$inferSelect.role
) {
  return (
    (version.origin !== 'answer' || role === 'assistant') &&
    version.origin === (snapshot.generation?.origin ?? 'answer') &&
    version.instruction ===
      (snapshot.generation?.origin === 'instruction' ? snapshot.generation.instruction : null)
  );
}

function replySelectionMatches(
  target: typeof messages.$inferSelect | undefined,
  version: typeof message_versions.$inferSelect | undefined,
  result: typeof replySnapshotSchema.Type
) {
  return (
    target?.session_id === result.sessionId &&
    target.active_version_id === result.versionId &&
    version?.message_id === result.messageId &&
    version.status !== 'complete'
  );
}
