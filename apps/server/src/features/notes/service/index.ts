/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates note operations across persistence, evidence lookup, and               │
 * │ durable workflow requests.                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns note, message, reply, title, and recording behavior across domain services.       │
 * │ - Coordinates typed failures and persistence effects for feature callers.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This is the notes feature boundary for RPC and workflow callers;                         │
 * │ store implementations stay private to the service.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { ErrorKind } from '@study/contracts/errors';
import { StudyError } from '@study/contracts/errors';
import type { MessageId, ProjectId, NoteId, SourceId } from '@study/contracts/ids';
import type { ContentInput } from '@study/contracts/inputs';
import type {
  noteArchiveInputSchema,
  setNoteItemArchivedSchema
} from '@study/contracts/notes/archive';
import { resolvedSelectionSchema, selectionReferenceKey } from '@study/contracts/notes/context';
import type {
  runSelectionContextSchema,
  noteContextIntentSchema,
  captureNoteContextSchema,
  updateNoteSelectionSchema
} from '@study/contracts/notes/context';
import { canConvertMessage } from '@study/contracts/notes/conversion';
import type { convertMessageInputSchema } from '@study/contracts/notes/conversion';
import type { noteDeletionSchema } from '@study/contracts/notes/deletion';
import type { ChatMessage } from '@study/contracts/notes/messages';
import type { transformSuggestionInputSchema } from '@study/contracts/notes/rpc';
import type {
  assistantAskInputSchema,
  createNoteInputSchema,
  createUntitledNoteInputSchema,
  updateMessageDescriptionInputSchema,
  editMessageInputSchema,
  postMessageInputSchema,
  setActiveVersionInputSchema,
  threadInputSchema,
  renameNoteInputSchema,
  notePageInputSchema,
  setNoteSettledInputSchema,
  noteGenerationPageInputSchema
} from '@study/contracts/notes/rpc';
import type {
  questionVersionInputSchema,
  setMessageKindInputSchema,
  questionClassificationSchema,
  askInputSchema,
  replyVersionInputSchema,
  publishReplyInputSchema,
  publishTitleInputSchema,
  replyRequestSchema,
  replyRequestInputSchema,
  reanswerInputSchema,
  rewriteMessageInputSchema
} from '@study/contracts/notes/schemas';
import { NoteMode } from '@study/contracts/notes/schemas';
import type { noteWorkInputSchema } from '@study/contracts/notes/work';
import type * as editing from '@study/contracts/pages/editing';
import type {
  transformRequestSchema,
  transformPublicationSchema
} from '@study/contracts/pages/transform';
import { mentionLabel, text } from '@study/localization';
import { Effect, Option, Schema } from 'effect';

import { NoteArchiveStore } from '#server/features/notes/store/archive';
import { NoteModeStore, NoteAssistantStore } from '#server/features/notes/store/assistant';
import { NoteBackupStore } from '#server/features/notes/store/backup';
import {
  NoteContextStore,
  NoteContextValidityStore,
  NoteSelectionStore,
  RetainedNoteContextStore,
  NoteContextIntentStore
} from '#server/features/notes/store/context';
import {
  NoteDeletionStore,
  NoteDeletionOwnershipStore,
  NoteDeletionCorrelationStore
} from '#server/features/notes/store/deletion';
import { NoteStore } from '#server/features/notes/store/index';
import { MessageStore, MessageVersionCitationsStore } from '#server/features/notes/store/message';
import { QuestionStore, QuestionAnswerStore } from '#server/features/notes/store/questions';
import { RecordingPostStore } from '#server/features/notes/store/recording';
import {
  ReplyStore,
  ReplyRequestStore,
  ReplyVersionStore,
  RetainedReplySnapshotStore,
  ReplyReadinessStore,
  ReplyWakeStore
} from '#server/features/notes/store/reply';
import { NoteSummaryStore } from '#server/features/notes/store/sidebar-summary';
import { TitleStore } from '#server/features/notes/store/title';
import { NoteWorkStore } from '#server/features/notes/store/work';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { Workflows } from '#server/features/workflows/index';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';
import { impactToken } from '#server/platform/definitions/impact-token';

import { activeNoteTargets } from './active-inputs.ts';
import { allArchivedItems } from './archive.ts';
import { resolveMessageCitations, resolveVersionCitations } from './citations.ts';
import { resolveSelection } from './selection.ts';

function requireAvailableNote(tx: Transaction, noteId: NoteId) {
  tx.store(NoteStore).note(noteId);

  if (Option.isSome(tx.store(NoteDeletionStore).findNoteDeletion(noteId)))
    throw new StudyError('not_found', 'Note is unavailable');
}

/** Recognizes whole assistant mention tokens without matching identifier suffixes. */
function mentionsAssistant(text: string) {
  return [...text.matchAll(/(?:^|\s)(@[\p{L}\p{M}\p{N}_]+)/gu)].some(
    (match) => match[1]!.toLowerCase() === mentionLabel('assistant')
  );
}

function readWorkspacePreferences() {
  return Settings.use((settings) => settings.workspacePreferences()).pipe(
    Effect.provide(Settings.layer)
  );
}

/** Captures at most one automatic title request per provisional note revision. */
function scheduleAutomaticTitle(tx: Transaction, noteId: NoteId) {
  const requestId = crypto.randomUUID();
  const snapshot = tx.store(TitleStore).captureAutomaticTitle({ noteId, requestId });

  if (Option.isSome(snapshot))
    tx.emit({
      type: 'NoteTitleRequested',
      eventId: crypto.randomUUID(),
      causationId: null,
      correlationId: requestId,
      inputVersion: 1,
      depth: 0,
      ...snapshot.value
    });
}

function normalizeAsk(input: typeof askInputSchema.Type) {
  return {
    noteId: input.noteId,
    threadRoot: input.threadRoot ?? null,
    intentKey: input.intentKey,
    expectedSelectionRevision: input.expectedSelectionRevision,
    text: input.text.trim(),
    sourceIds: input.sourceIds ?? [],
    instruction: input.instruction ?? '',
    preferences: {
      language: input.preferences?.language,
      detail: input.preferences?.detail
    }
  };
}

import { makeAssistantNotes } from './assistant.ts';
import { ensureNote, notebookNote } from './ensure-note.ts';
import { mergeNotes } from './merge.ts';

export const Notes = defineService(
  'study/Notes',
  function* () {
    const readReplyReadinessStore = yield* useStore(ReplyReadinessStore);

    const readReplyWakeStore = yield* useStore(ReplyWakeStore);

    const store = yield* useStore(NoteStore);
    const modes = yield* useStore(NoteModeStore);
    const summaries = yield* useStore(NoteSummaryStore);

    const titles = yield* useStore(TitleStore);

    const selections = yield* useStore(NoteSelectionStore);

    const retainedContexts = yield* useStore(RetainedNoteContextStore);

    const assistant = yield* makeAssistantNotes;
    const { assistantNote } = assistant;

    const ask = Effect.fnUntraced(function* (input: typeof askInputSchema.Type) {
      const preferences = yield* readWorkspacePreferences();

      return yield* transaction((tx) => {
        const normalized = normalizeAsk(input);
        const askDigest = impactToken(normalized);
        const intent = {
          noteId: input.noteId,
          threadRoot: input.threadRoot,
          intentKey: input.intentKey,
          instruction: normalized.instruction,
          preferences: normalized.preferences,
          askDigest
        };
        const existing = tx.store(NoteContextIntentStore).findNoteContextIntent(intent);

        if (Option.isSome(existing)) {
          const context = existing.value;
          const previous = tx
            .store(ReplyRequestStore)
            .findReplyRequest({ requestId: context.requestId });
          const note = askUserTarget(context);

          if (Option.isNone(previous) || !note || note.role !== 'user')
            throw new StudyError('not_found', 'Captured Ask is unavailable');

          for (const target of context.inputs) assertCapturedTarget(tx, target);

          return {
            ...previous.value,
            userMessageId: note.messageId,
            userVersionId: note.versionId
          };
        }

        const selection = tx.store(NoteSelectionStore).noteSelection({ noteId: input.noteId });

        if (selection.revision !== input.expectedSelectionRevision)
          throw new StudyError('invalid_input', 'Note selection changed');

        if (tx.store(NoteModeStore).noteMode(input.noteId) === NoteMode.Assistant)
          retireAssistantReplies(tx, input.noteId);

        tx.store(ReplyStore).prepareReply(input);
        const note = postMessage(tx, input);
        const context = captureContext(
          tx,
          { ...intent, throughMessageId: note.id },
          crypto.randomUUID(),
          true
        );
        const result = tx
          .store(ReplyStore)
          .requestReply({ ...input, requestId: context.requestId, context });

        emitReplyRequest(tx, result, 'reply');

        retainExplicitQuestionAnswer(tx, note, result);

        if (preferences.textConversionMode === 'automatic')
          scheduleAutomaticConversion(tx, note, preferences.textConversionStrategy);

        return { ...result, userMessageId: note.id, userVersionId: note.activeVersionId! };
      });
    });

    return {
      noteMode: modes.noteMode,
      ...assistant,
      /** A manual question mark commits its answer request with the classification. */
      setMessageKind: (input: typeof setMessageKindInputSchema.Type) =>
        transaction((tx) => {
          tx.store(QuestionStore).setQuestionKind(input);

          if (input.kind === 'question') answerQuestion(tx, input);

          return tx.store(MessageStore).message(input.messageId);
        }),
      answerQuestion: (input: typeof questionVersionInputSchema.Type) =>
        transaction((tx) => answerQuestion(tx, input)),
      questionSnapshot: (input: typeof questionVersionInputSchema.Type) =>
        transaction((tx) => tx.store(QuestionStore).questionSnapshot(input)),
      /** Commits detection independently so rejected automatic answers cannot erase the saved kind. */
      publishQuestion: Effect.fnUntraced(function* (
        input: typeof questionVersionInputSchema.Type & typeof questionClassificationSchema.Type
      ) {
        yield* publicationTransaction((tx) => {
          tx.store(QuestionStore).publishQuestion(input);
        });

        if (input.kind !== 'question') return;

        const preferences = yield* readWorkspacePreferences();

        if (preferences.autoAnswerQuestions)
          yield* publicationTransaction((tx) => {
            answerQuestion(tx, input);
          });
      }),
      applyPageProposal: (value: typeof editing.applyProposalSchema.Type) =>
        transaction((tx) => {
          const replay = Pages.findProposalReceiptInTransaction(tx, {
            ...value,
            operation: 'apply'
          });

          if (replay) return replay;

          const request = Pages.findTransformInTransaction(tx, value);
          let relevantValid = true;

          if (request) {
            if (request.cancelled)
              throw new StudyError('cancelled', 'Proposal generation is unavailable');

            const context = readCapturedContext(tx, request.contextRequestId);

            relevantValid =
              context.inputs.every((item) => inputIsCurrent(tx, item.input)) &&
              tx
                .store(NoteContextValidityStore)
                .noteContextValidity({ requestId: request.contextRequestId });
          }

          return Pages.applyProposalInTransaction(tx, value, relevantValid);
        }),
      keepPageProposal: (value: typeof editing.keepProposalSchema.Type) =>
        transaction((tx) => {
          const replay = Pages.findProposalReceiptInTransaction(tx, {
            ...value,
            operation: 'keep'
          });

          if (replay) return replay;

          const request = Pages.findTransformInTransaction(tx, value);

          if (request) {
            if (request.cancelled)
              throw new StudyError('cancelled', 'Proposal generation is unavailable');

            readCapturedContext(tx, request.contextRequestId);
          }

          return Pages.keepProposalInTransaction(tx, value);
        }),
      requestPageTransform: (value: typeof transformRequestSchema.Type) =>
        transaction((tx) =>
          Pages.requestTransformInTransaction(
            tx,
            readCapturedContext(tx, value.contextRequestId),
            value
          )
        ),
      pageTransformContext: (value: { requestId: string }) =>
        transaction((tx) => {
          const request = Pages.transformInTransaction(tx, value);
          const context = readCapturedContext(tx, request.contextRequestId);

          if (request.cancelled || context.instruction !== request.instruction)
            throw new StudyError('cancelled', 'Page generation is unavailable');

          return context;
        }),
      publishPageTransform: (value: typeof transformPublicationSchema.Type) =>
        publicationTransaction((tx) => {
          const request = Pages.transformInTransaction(tx, value);
          const context =
            request.resultVersionId === null
              ? readCapturedContext(tx, request.contextRequestId)
              : undefined;

          return Pages.publishTransformInTransaction(tx, context, value);
        }),
      retryPageTransform: (value: { requestId: string; retryId: string }) =>
        transaction((tx) => {
          const request = Pages.transformInTransaction(tx, value);

          if (request.resultVersionId === null) readCapturedContext(tx, request.contextRequestId);

          return Pages.retryTransformInTransaction(tx, value);
        }),
      archivedItems: (input: typeof noteArchiveInputSchema.Type) =>
        transaction((tx) => allArchivedItems(tx, input.noteId)),
      setItemArchived: (input: typeof setNoteItemArchivedSchema.Type) =>
        transaction((tx) => {
          const archivedAt = tx.store(NoteArchiveStore).setItemArchived(input);

          if (input.target.kind === 'page')
            Pages.archiveNoteInTransaction(tx, {
              noteId: input.noteId,
              pageId: input.target.id,
              archivedAt
            });
          else if (input.target.kind === 'source')
            Sources.archiveNoteInTransaction(tx, {
              noteId: input.noteId,
              sourceId: input.target.id,
              archivedAt
            });
        }),
      noteSelection: selections.noteSelection,
      updateNoteSelection: (input: typeof updateNoteSelectionSchema.Type) =>
        transaction((tx) => {
          resolveTargets(tx, input.targets);

          return tx.store(NoteSelectionStore).updateSelection(input);
        }),
      requestTransformSuggestion: (input: typeof transformSuggestionInputSchema.Type) =>
        transaction((tx) => {
          const capture = {
            noteId: input.noteId,
            additionalNoteIds: input.additionalNoteIds?.length
              ? input.additionalNoteIds
              : undefined,
            intentKey: `suggest/${input.field}/${input.intentKey}`,
            instruction: '',
            preferences: { language: input.language }
          };
          const existing = tx.store(NoteContextIntentStore).findNoteContextIntent(capture);
          const context = captureContext(tx, capture, crypto.randomUUID());
          const event = {
            type: 'TransformSuggestionRequested' as const,
            eventId: `suggest/${context.requestId}`,
            causationId: null,
            correlationId: context.requestId,
            inputVersion: 1,
            depth: 0,
            noteId: input.noteId,
            contextRequestId: context.requestId,
            field: input.field,
            language: input.language
          };

          if (Option.isNone(existing)) tx.emit(event);

          return event;
        }),
      captureNoteContext: (input: typeof captureNoteContextSchema.Type) =>
        transaction((tx) => captureContext(tx, input, crypto.randomUUID())),
      inspectNoteContext: retainedContexts.retainedNoteContext,
      noteContext: (input: { requestId: string }) =>
        transaction((tx) => {
          const snapshot = tx.store(NoteContextStore).noteContext(input);

          for (const target of snapshot.inputs) assertCapturedTarget(tx, target);

          return snapshot;
        }),
      mergeNotes,
      titleSnapshot: titles.titleSnapshot,
      createUntitledNote: Effect.fnUntraced(function* (
        input: typeof createUntitledNoteInputSchema.Type
      ) {
        const settings = yield* Settings;
        const language = yield* settings.language();
        const preferences = yield* readWorkspacePreferences();

        return yield* transaction((tx) => {
          const note = tx.store(NoteStore).createNote({
            project: input.project,
            title: text(language, 'NewNote'),
            titleSource: 'provisional'
          });

          if (input.initialMessage) {
            const message = postMessage(tx, {
              ...input.initialMessage,
              noteId: note.id,
              requestReply: false
            });

            if (preferences.textConversionMode === 'automatic')
              scheduleAutomaticConversion(tx, message, preferences.textConversionStrategy);

            if (preferences.autoTitleNotes) scheduleAutomaticTitle(tx, note.id);
          }

          return note;
        });
      }),
      requestTitle: (input: { noteId: NoteId }) =>
        transaction((tx) => {
          const requestId = crypto.randomUUID();

          const snapshot = tx.store(TitleStore).captureTitle({ ...input, requestId });

          tx.emit({
            type: 'NoteTitleRequested',
            eventId: crypto.randomUUID(),
            causationId: null,
            correlationId: requestId,
            inputVersion: 1,
            depth: 0,
            ...snapshot
          });

          return { requestId, noteId: input.noteId };
        }),
      publishTitle: (input: typeof publishTitleInputSchema.Type) =>
        publicationTransaction((tx) => {
          return tx.store(TitleStore).publishTitle(input);
        }),
      replySnapshot: (input: { requestId: string }) =>
        transaction((tx) => {
          tx.store(QuestionStore).assertQuestionAnswer(input);
          const snapshot = tx.store(ReplyStore).replySnapshot(input);

          if (snapshot.context) {
            tx.store(NoteContextStore).noteContext(input);

            for (const target of snapshot.context.inputs) assertCapturedTarget(tx, target);
          }

          return snapshot;
        }),
      inspectReplySnapshot: (input: { requestId: string }) =>
        transaction((tx) => tx.store(RetainedReplySnapshotStore).retainedReplySnapshot(input)),
      replyReadiness: readReplyReadinessStore.replyReadiness,
      replyWakes: readReplyWakeStore.replyWakes,
      sealReplyAttachments: (input: { requestId: string }) =>
        publicationTransaction((tx) => {
          return tx.store(ReplyStore).sealReplyAttachments(input);
        }),
      failConversion: (input: typeof replyRequestSchema.Type) =>
        publicationTransaction((tx) => tx.store(ReplyStore).failConversion(input)),
      abandonReply: (input: typeof replyRequestSchema.Type) =>
        publicationTransaction((tx) => {
          return tx.store(ReplyStore).abandonReply(input);
        }),
      publishReply: Effect.fnUntraced(function* (input: typeof publishReplyInputSchema.Type) {
        const preferences = yield* readWorkspacePreferences();
        const language = yield* Settings.use((settings) => settings.language()).pipe(
          Effect.provide(Settings.layer)
        );

        return yield* publicationTransaction((tx) => {
          const context = tx
            .store(NoteContextStore)
            .findNoteContext({ requestId: input.requestId });

          if (Option.isSome(context))
            for (const target of context.value.inputs) assertCapturedTarget(tx, target);

          tx.store(QuestionStore).assertQuestionAnswer(input);
          const versionId = tx.store(ReplyStore).publishReply({ ...input, language });

          if (preferences.autoTitleNotes) {
            const reply = tx
              .store(ReplyRequestStore)
              .findReplyRequest({ requestId: input.requestId });

            if (Option.isSome(reply)) scheduleAutomaticTitle(tx, reply.value.noteId);
          }

          return versionId;
        });
      }),
      messageVersionCitations: (input: typeof replyVersionInputSchema.Type) =>
        transaction((tx) => {
          if (Option.isSome(tx.store(NoteDeletionStore).findNoteDeletion(input.noteId)))
            throw new StudyError('not_found', 'Note is unavailable');

          const value = tx.store(MessageVersionCitationsStore).messageVersionCitations(input);

          return { ...value, citations: resolveVersionCitations(tx, value.citations) };
        }),
      noteGenerations: (input: typeof noteGenerationPageInputSchema.Type) =>
        transaction((tx) => {
          requireAvailableNote(tx, input.noteId);

          const items = Pages.transformsInTransaction(tx, input)
            .map((request) => ({
              requestId: request.id,
              contextRequestId: request.contextRequestId,
              state: 'available' as 'available' | 'unavailable' | 'retired',
              cancelled: request.cancelled,
              resultVersionId:
                request.editTargetVersionId === undefined ? request.resultVersionId : null,
              proposedVersionId:
                request.editTargetVersionId === undefined ? null : request.resultVersionId,
              baseVersionId: request.editTargetVersionId ?? null
            }))
            .map((item) => {
              if (item.state !== 'available' || item.contextRequestId === null) return item;

              try {
                readCapturedContext(tx, item.contextRequestId);

                return item;
              } catch (error) {
                if (
                  error instanceof StudyError &&
                  (error.kind === 'not_found' || error.kind === 'invalid_input')
                )
                  return { ...item, state: 'unavailable' as const };

                throw error;
              }
            });
          const last = items.at(-1);
          const more =
            last && items.length === input.limit
              ? Pages.transformsInTransaction(tx, {
                  ...input,
                  limit: 1,
                  before: last.requestId
                })
              : [];

          return { items, next: more.length && last ? last.requestId : null };
        }),
      replyVersion: (input: typeof replyVersionInputSchema.Type) =>
        transaction((tx) => {
          const provenance = tx.store(ReplyVersionStore).replyVersion(input);

          if (provenance.state !== 'available') return provenance;

          try {
            readCapturedContext(tx, provenance.requestId);

            return provenance;
          } catch (error) {
            if (
              error instanceof StudyError &&
              (error.kind === 'not_found' || error.kind === 'invalid_input')
            )
              return { state: 'unavailable' as const, requestId: provenance.requestId };

            throw error;
          }
        }),
      ask,
      ensureNote,
      notebookNote,
      assistantAsk: Effect.fnUntraced(function* (input: typeof assistantAskInputSchema.Type) {
        const note = yield* assistantNote({ id: input.noteId });

        const result = yield* ask({
          ...input,
          noteId: note.id,
          expectedSelectionRevision: 0n
        });

        if (note.title === text('english', 'Assistant'))
          yield* transaction((tx) =>
            tx.store(NoteStore).renameNote({
              id: note.id,
              title: [...input.text.trim()].slice(0, 80).join('')
            })
          );

        return result;
      }),
      requestReply: (input: typeof replyRequestInputSchema.Type) =>
        transaction((tx) => {
          const intent = {
            noteId: input.noteId,
            threadRoot: input.threadRoot,
            intentKey: input.intentKey ?? crypto.randomUUID(),
            instruction: input.instruction ?? '',
            preferences: input.preferences ?? {}
          };

          const existing = tx.store(NoteContextIntentStore).findNoteContextIntent(intent);

          if (Option.isSome(existing)) {
            const previous = tx
              .store(ReplyRequestStore)
              .findReplyRequest({ requestId: existing.value.requestId });

            if (Option.isSome(previous)) {
              for (const target of existing.value.inputs) assertCapturedTarget(tx, target);

              return previous.value;
            }

            throw new StudyError('not_found', 'Captured reply request is unavailable');
          }

          tx.store(ReplyStore).prepareReply(input);

          const context = captureContext(tx, intent, crypto.randomUUID(), true);

          const requestId = context.requestId;

          const previous = tx.store(ReplyRequestStore).findReplyRequest({ requestId });

          if (Option.isSome(previous)) return previous.value;

          const result = tx.store(ReplyStore).requestReply({ ...input, requestId, context });

          const target = context.messages.at(-1);

          if (target?.role === 'user')
            retainExplicitQuestionAnswer(
              tx,
              tx.store(MessageStore).message(target.messageId),
              result
            );

          emitReplyRequest(tx, result, 'reply');

          return result;
        }),
      reanswer: (input: typeof reanswerInputSchema.Type) =>
        transaction((tx) => requestTarget(tx, { ...input, origin: 'answer' })),
      convertMessage: (input: typeof convertMessageInputSchema.Type) =>
        transaction((tx) => requestConversion(tx, input)),
      rewriteMessage: (input: typeof rewriteMessageInputSchema.Type) =>
        transaction((tx) => requestTarget(tx, input)),
      message: (id: MessageId) =>
        transaction((tx) => resolveMessageCitations(tx, tx.store(MessageStore).message(id))),
      thread: (input: typeof threadInputSchema.Type) =>
        transaction((tx) => {
          const messages = tx.store(MessageStore);

          const items = messages.messages(input);

          const first = items[0];

          const more =
            first && items.length === input.limit
              ? messages.messages({
                  noteId: input.noteId,
                  threadRoot: input.threadRoot,
                  limit: 1,
                  before: first.id
                })
              : [];

          return {
            items: items.map((message) => resolveMessageCitations(tx, message)),
            next: more.length && first ? first.id : null
          };
        }),
      postRecordingMessage: (input: {
        requestId: string;
        noteId: NoteId;
        sourceId: SourceId;
        projectId: ProjectId | null;
        durationMs: number;
      }) =>
        publicationTransaction((tx) => {
          const recording = tx.store(RecordingPostStore);

          const existing = recording.prepareRecordingPost(input);

          if (existing !== null) return existing;

          const message = postMessage(tx, {
            noteId: input.noteId,
            text: '',
            sourceIds: [input.sourceId]
          });

          return recording.finishRecordingPost({ ...input, messageId: message.id });
        }),
      postMessage: Effect.fnUntraced(function* (input: typeof postMessageInputSchema.Type) {
        const preferences = yield* readWorkspacePreferences();

        return yield* transaction((tx) => {
          const message = postMessage(tx, input);

          const mentioned = mentionsAssistant(input.text);

          if (input.requestReply ?? mentioned) {
            const requestId = crypto.randomUUID();

            tx.store(ReplyStore).prepareReply({
              noteId: input.noteId,
              threadRoot: input.threadRoot
            });

            const context = captureContext(
              tx,
              {
                noteId: input.noteId,
                threadRoot: input.threadRoot,
                intentKey: requestId,
                instruction: '',
                preferences: {}
              },
              requestId
            );

            const result = tx.store(ReplyStore).requestReply({
              noteId: input.noteId,
              threadRoot: input.threadRoot,
              requestId,
              context
            });

            retainExplicitQuestionAnswer(tx, message, result);
            tx.emit({
              type: 'NoteGenerationRequested',
              eventId: crypto.randomUUID(),
              causationId: null,
              correlationId: requestId,
              inputVersion: 1,
              depth: 0,
              ...result,
              operation: 'reply'
            });
          }

          if (preferences.textConversionMode === 'automatic')
            scheduleAutomaticConversion(tx, message, preferences.textConversionStrategy);

          if (preferences.autoTitleNotes) scheduleAutomaticTitle(tx, input.noteId);

          return tx.store(MessageStore).message(message.id);
        });
      }),
      updateMessageDescription: (input: typeof updateMessageDescriptionInputSchema.Type) =>
        transaction((tx) =>
          resolveMessageCitations(tx, tx.store(MessageStore).updateMessageDescription(input))
        ),
      editNoteNote: (noteId: NoteId, input: typeof editMessageInputSchema.Type) =>
        transaction((tx) => {
          requireAvailableNote(tx, noteId);
          const note = tx.store(MessageStore).message(input.messageId);

          if (
            note.noteId !== noteId ||
            note.role !== 'user' ||
            note.parts.length ||
            input.expectedActiveVersionId === undefined
          )
            throw new StudyError('not_found', 'Editable text note is not in this note');

          const edited = tx.store(MessageStore).editMessage(input);

          scheduleQuestion(tx, edited);

          return resolveMessageCitations(tx, edited);
        }),
      editMessage: (input: typeof editMessageInputSchema.Type) =>
        transaction((tx) => {
          const message = tx.store(MessageStore).editMessage(input);

          scheduleQuestion(tx, message);

          return resolveMessageCitations(tx, message);
        }),
      /** Preserves classification on no-op selections and requeues changed content versions. */
      setActiveVersion: (input: typeof setActiveVersionInputSchema.Type) =>
        transaction((tx) => {
          const previous = tx.store(MessageStore).message(input.messageId).activeVersionId;
          const message = tx.store(MessageStore).setActiveVersion(input);

          if (previous !== message.activeVersionId) scheduleQuestion(tx, message, true);

          return resolveMessageCitations(tx, message);
        }),
      /** Reclassifies only when version deletion selects different active content. */
      deleteMessageVersion: (input: typeof setActiveVersionInputSchema.Type) =>
        transaction((tx) => {
          const previous = tx.store(MessageStore).message(input.messageId).activeVersionId;
          const message = tx.store(MessageStore).deleteMessageVersion(input);

          if (previous !== message.activeVersionId) scheduleQuestion(tx, message, true);

          return resolveMessageCitations(tx, message);
        }),
      deleteMessage: (id: MessageId) =>
        transaction((tx) => tx.store(MessageStore).deleteMessage(id)),
      renameNote: (input: typeof renameNoteInputSchema.Type) =>
        transaction((tx) => tx.store(NoteStore).renameNote(input)),
      noteWork: (input: typeof noteWorkInputSchema.Type) =>
        transaction((tx) => {
          requireAvailableNote(tx, input.noteId);

          const rows = tx.store(NoteWorkStore).noteWorkItems(input);
          const items = rows.map(({ executionId, createdAtMs: _, ...item }) => ({
            ...item,
            execution: Workflows.executionInTransaction(tx, executionId)
          }));
          const last = items.at(-1)?.execution;
          const cursor = last ? { id: last.id, createdAtMs: last.createdAtMs } : null;
          const more =
            cursor && rows.length === input.limit
              ? tx.store(NoteWorkStore).noteWorkItems({ ...input, before: cursor, limit: 1 })
              : [];

          return { items, next: more.length ? cursor : null };
        }),
      noteSummaries: summaries.noteSummary,
      setNoteSettled: (input: typeof setNoteSettledInputSchema.Type) =>
        transaction((tx) => tx.store(NoteSummaryStore).setNoteSettled(input)),
      note: store.note,
      findNote: store.findNote,
      notes: Effect.fnUntraced(function* (input: typeof notePageInputSchema.Type) {
        const items = yield* store.notes(input);

        const last = items.at(-1);

        const more =
          last && items.length === input.limit
            ? yield* store.notes({
                project: input.project,
                limit: 1,
                before: { updatedAt: last.updatedAt, id: last.id }
              })
            : [];

        return {
          items,
          next: more.length && last ? { updatedAt: last.updatedAt, id: last.id } : null
        };
      }),
      createNote: (input: typeof createNoteInputSchema.Type) =>
        transaction((tx) => tx.store(NoteStore).createNote({ ...input, titleSource: 'user' })),
      noteDeletionExecutions: (id: NoteId) =>
        transaction((tx) =>
          Workflows.retireCorrelations(tx, deletionCorrelations(tx, id), deletionEventTypes)
        ),
      noteDeletion: (id: NoteId) =>
        transaction((tx) => tx.store(NoteDeletionStore).noteDeletion(id)),
      retryNoteDeletion: (id: NoteId) =>
        transaction((tx) => {
          const previous = tx.store(NoteDeletionStore).noteDeletion(id);

          const runs = Workflows.correlatedExecutions(
            tx,
            previous.operationId,
            `${previous.operationId}/${previous.attempt}`
          );

          const pendingTerminal =
            runs.length > 0 &&
            runs.every((run) => run.status === 'completed' || run.status === 'cancelled');

          const result = tx.store(NoteDeletionStore).retry({ noteId: id, pendingTerminal });

          if (result.attempt !== previous.attempt) emitDeletion(tx, result);

          return result;
        }),
      finishNoteDeletion: (value: { noteId: NoteId; attempt: number }) =>
        publicationTransaction((tx) => {
          const status = tx.store(NoteDeletionStore).noteDeletion(value.noteId);

          if (status.status === 'completed' || status.attempt !== value.attempt) return status;

          Workflows.scrubRetiredCorrelations(tx, deletionCorrelations(tx, value.noteId));

          return tx.store(NoteDeletionStore).settle({ ...value, errorKind: null });
        }),
      failNoteDeletion: (value: { noteId: NoteId; errorKind: ErrorKind; attempt: number }) =>
        transaction((tx) => tx.store(NoteDeletionStore).settle(value)),
      deleteNote: (id: NoteId) =>
        transaction((tx) => {
          const existing = tx.store(NoteDeletionStore).findNoteDeletion(id);

          if (Option.isSome(existing)) return existing.value;

          const child = tx.store(NoteAssistantStore).findNoteAssistant(id);
          const ownership = (Option.isSome(child) ? [id, child.value] : [id]).map((noteId) =>
            tx.store(NoteDeletionOwnershipStore).deletionOwnership(noteId)
          );
          const owned = {
            contextIds: ownership.flatMap((value) => value.contextIds),
            correlations: ownership.flatMap((value) => value.correlations)
          };

          const status = tx
            .store(NoteDeletionStore)
            .accept({ noteId: id, operationId: crypto.randomUUID() });

          const generations = Pages.prepareNoteRetirement(tx, {
            noteId: id,
            contextIds: owned.contextIds
          });

          tx.store(NoteDeletionStore).retainCorrelations({
            noteId: id,
            correlations: [...owned.correlations, ...generations]
          });

          Workflows.retireCorrelations(
            tx,
            [...owned.correlations, ...generations],
            deletionEventTypes
          );
          tx.store(NoteDeletionStore).retireCaptures(owned.contextIds);
          tx.store(NoteDeletionStore).removeNote(id);
          emitDeletion(tx, status);

          return status;
        })
    };
  },
  {
    createNoteInTransaction: (tx: Transaction, input: typeof createNoteInputSchema.Type) =>
      tx.store(NoteStore).createNote({ ...input, titleSource: 'user' }),
    postMessageInTransaction: postMessage,
    prepareBackup: (tx: Transaction) => tx.store(NoteBackupStore).prepare(undefined),
    validateBackup: (tx: Transaction, requireRetired = false) =>
      tx.store(NoteBackupStore).backupNote(requireRetired)
  }
);

/** Source membership is independent of the raw message that introduced it. */
function postMessage(tx: Transaction, input: typeof postMessageInputSchema.Type) {
  const message = tx.store(MessageStore).postMessage(input);

  scheduleQuestion(tx, message);

  for (const sourceId of input.sourceIds ?? [])
    Sources.attachInTransaction(tx, { noteId: input.noteId, sourceId });

  return message;
}

function resolveTargets(tx: Transaction, targets: typeof updateNoteSelectionSchema.Type.targets) {
  if (new Set(targets.map((target) => selectionReferenceKey(target.input))).size !== targets.length)
    throw new StudyError('invalid_input', 'Duplicate selected version');

  const resolved = targets.map((target) => resolveSelection(tx, target));

  if (resolved.reduce((sum, item) => sum + item.excerpts.length, 0) > 200)
    throw new StudyError('not_enough', 'Active note context has too many passages');

  if (
    resolved.reduce(
      (sum, item) => sum + item.excerpts.reduce((n, excerpt) => n + excerpt.text.length, 0),
      0
    ) > 100000
  )
    throw new StudyError('not_enough', 'Active note context exceeds limit');

  return resolved;
}

function requestTarget(
  tx: Transaction,
  input:
    | typeof rewriteMessageInputSchema.Type
    | (typeof reanswerInputSchema.Type & { origin: 'answer' })
) {
  const requestId = crypto.randomUUID();

  tx.store(ReplyStore).retireTargetPending(input);

  const message = tx.store(MessageStore).message(input.messageId);

  const context = captureContext(
    tx,
    {
      noteId: message.noteId,
      threadRoot: message.threadRoot ?? undefined,
      throughMessageId: input.origin === 'answer' ? (message.replyTo ?? undefined) : message.id,
      intentKey: requestId,
      instruction: input.origin === 'answer' ? '' : (input.instruction ?? ''),
      preferences: {}
    },
    requestId,
    true
  );

  const result = tx.store(ReplyStore).requestTarget({ ...input, requestId, context });

  emitReplyRequest(tx, result, input.origin === 'answer' ? 'reply' : 'rewrite');

  return result;
}

function emitReplyRequest(
  tx: Transaction,
  result: typeof replyRequestSchema.Type,
  operation: 'reply' | 'rewrite'
) {
  tx.emit({
    type: 'NoteGenerationRequested',
    eventId: crypto.randomUUID(),
    causationId: null,
    correlationId: result.requestId,
    inputVersion: 1,
    depth: 0,
    ...result,
    operation
  });
}

function captureContext(
  tx: Transaction,
  input: typeof noteContextIntentSchema.Type,
  requestId: string,
  deferPendingAttachments = false
) {
  const store = tx.store(NoteContextStore);

  const existing = tx.store(NoteContextIntentStore).findNoteContextIntent(input);

  if (Option.isSome(existing)) {
    for (const target of existing.value.inputs) assertCapturedTarget(tx, target);

    return existing.value;
  }

  const ids = [input.noteId, ...(input.additionalNoteIds ?? [])];

  if (
    new Set(ids).size !== ids.length ||
    (ids.length > 1 && (input.threadRoot !== undefined || input.throughMessageId !== undefined))
  )
    throw new StudyError('invalid_input', 'Combined capture requires distinct whole notes');

  const targets = ids.flatMap((noteId) =>
    activeNoteTargets(tx, noteId, { ...input, deferPendingAttachments })
  );
  const inputs = input.additionalNoteIds
    ? resolveCombinedTargets(tx, targets)
    : resolveTargets(tx, targets);

  return store.capture({ ...input, requestId, inputs });
}

/** Union exact selected passages without duplicating shared source versions. */
function resolveCombinedTargets(
  tx: Transaction,
  targets: typeof updateNoteSelectionSchema.Type.targets
) {
  const grouped = new Map<string, (typeof resolvedSelectionSchema.Type)[]>();

  for (const target of targets) {
    const resolved = resolveSelection(tx, target);
    const key = selectionReferenceKey(target.input);

    grouped.set(key, [...(grouped.get(key) ?? []), resolved]);
  }

  return resolveTargets(
    tx,
    [...grouped.values()].map((items) => {
      const whole = items.find((item) => item.scope.kind === 'document');

      if (whole) return whole;

      if (items.length === 1) return items[0]!;

      const first = items[0]!;

      if (items.every((item) => item.scope.kind === 'blocks')) {
        const blockIds = [
          ...new Set(
            items.flatMap((item) => (item.scope.kind === 'blocks' ? item.scope.blockIds : []))
          )
        ];

        return {
          input: first.input,
          scope: { kind: 'blocks' as const, blockIds }
        };
      }

      const ranges = [
        ...new Map(
          items
            .flatMap((item) =>
              item.excerpts.map((excerpt) => ({
                blockId: excerpt.blockId,
                start: excerpt.start,
                end: excerpt.end
              }))
            )
            .map((range) => [`${range.blockId}:${range.start}:${range.end}`, range])
        ).values()
      ];

      return {
        input: first.input,
        scope: { kind: 'ranges' as const, ranges }
      };
    })
  );
}

const resolvedCodec = Schema.fromJsonString(Schema.toCodecJson(resolvedSelectionSchema));

function assertCapturedTarget(tx: Transaction, target: typeof resolvedSelectionSchema.Type) {
  const resolved = resolveSelection(tx, target);

  if (
    Schema.encodeSync(resolvedCodec)({ ...resolved, name: target.name }) !==
    Schema.encodeSync(resolvedCodec)(target)
  )
    throw new StudyError('not_found', 'Captured exact content is unavailable');
}

/** Availability checked immutable context, composed inside another feature transaction. */

function inputIsCurrent(tx: Transaction, input: ContentInput) {
  if (input.kind === 'page') {
    const version = Pages.versionInTransaction(tx, input.versionId);

    return Pages.pageInTransaction(tx, { id: version.pageId }).headVersionId === version.id;
  }

  const current = Sources.currentExtractionInTransaction(tx, input.sourceId);

  return (
    current !== null &&
    current.revision === input.revision &&
    current.snapshotId === input.snapshotId
  );
}

function readCapturedContext(tx: Transaction, requestId: string) {
  const snapshot = tx.store(NoteContextStore).noteContext({ requestId });

  tx.store(NoteStore).note(snapshot.noteId);

  for (const target of snapshot.inputs) assertCapturedTarget(tx, target);

  return snapshot;
}

function deletionCorrelations(tx: Transaction, id: NoteId) {
  return tx.store(NoteDeletionCorrelationStore).deletionCorrelation(id).correlations;
}

function emitDeletion(tx: Transaction, value: typeof noteDeletionSchema.Type) {
  tx.emit({
    type: 'NoteDeletionRequested',
    eventId: `${value.operationId}/${value.attempt}`,
    causationId: null,
    correlationId: value.operationId,
    inputVersion: 1,
    depth: 0,
    noteId: value.noteId,
    attempt: value.attempt
  });
}

/** Source extraction and MaterialPublished notifications have independent library ownership. */

const deletionEventTypes = [
  'PageGenerationRequested',
  'PageGenerationFailed',
  'PagePublished',
  'NoteGenerationRequested',
  'NoteTitleRequested',
  'TransformSuggestionRequested',
  'NoteQuestionRequested',
  'RecordingPostRequested',
  'MaterialGenerationRequested',
  'MaterialGenerationFailed'
] as const;

/** Schedules replay-safe detection only when the saved note is eligible. */
function scheduleQuestion(tx: Transaction, message: ChatMessage, reclassify = false) {
  if (tx.store(NoteModeStore).noteMode(message.noteId) === NoteMode.Assistant) return;

  const versionId = message.activeVersionId;

  if (!versionId || !questionEligible(message)) return;

  if (
    !reclassify &&
    tx
      .store(QuestionStore)
      .questionSnapshot({ messageId: message.id, expectedActiveVersionId: versionId }).scheduled
  )
    return;

  emitQuestionRequest(
    tx,
    message,
    versionId,
    reclassify ? crypto.randomUUID() : `question/${message.id}/${versionId}`
  );
}

/** Persists question follow-up work atomically with the classification or capture it belongs to. */
function emitQuestionRequest(
  tx: Transaction,
  message: ChatMessage,
  versionId: NonNullable<ChatMessage['activeVersionId']>,
  eventId: string
) {
  tx.emit({
    type: 'NoteQuestionRequested',
    eventId,
    causationId: null,
    correlationId: `question/${message.id}/${versionId}`,
    inputVersion: 1,
    depth: 0,
    noteId: message.noteId,
    messageId: message.id,
    versionId
  });
}

/** Reuses an existing answer or captures the exact question version for generation. */
function answerQuestion(tx: Transaction, input: typeof questionVersionInputSchema.Type) {
  const existing = tx.store(QuestionAnswerStore).findQuestionAnswer(input);

  if (Option.isSome(existing)) {
    if (!questionAnswerRetryable(tx, existing.value)) return existing.value;

    tx.store(QuestionStore).retireQuestionAnswer(input);
  }

  const message = tx.store(MessageStore).message(input.messageId);
  const intentKey = `question/${message.id}/${input.expectedActiveVersionId}/${crypto.randomUUID()}`;
  const context = captureContext(
    tx,
    {
      noteId: message.noteId,
      threadRoot: message.threadRoot ?? undefined,
      throughMessageId: message.id,
      intentKey,
      instruction: '',
      preferences: {}
    },
    crypto.randomUUID(),
    true
  );

  if (
    context.messages.at(-1)?.messageId !== message.id ||
    context.messages.at(-1)?.versionId !== input.expectedActiveVersionId
  )
    throw new StudyError('invalid_input', 'Question context changed');

  const result = tx.store(ReplyStore).requestQuestionReply({
    noteId: message.noteId,
    threadRoot: message.threadRoot ?? undefined,
    requestId: context.requestId,
    context
  });

  tx.store(QuestionStore).retainQuestionAnswer({ ...input, answer: result });
  emitReplyRequest(tx, result, 'reply');

  return result;
}

/** Keeps explicit reply requests reusable without imposing automatic-question publication rules. */
function retainExplicitQuestionAnswer(
  tx: Transaction,
  message: ChatMessage,
  answer: typeof replyRequestSchema.Type
) {
  if (message.role === 'user' && message.format !== 'document' && message.activeVersionId)
    tx.store(QuestionStore).retainQuestionAnswer({
      messageId: message.id,
      expectedActiveVersionId: message.activeVersionId,
      answer,
      guard: false
    });
}

/** Allows a new request only after unfinished answer work has settled unsuccessfully. */
function questionAnswerRetryable(tx: Transaction, receipt: typeof replyRequestSchema.Type) {
  const answer = tx.store(MessageStore).message(receipt.messageId);
  const version = answer.versions.find((v) => v.id === receipt.versionId);

  if (version?.status === 'complete') return false;

  const runs = Workflows.correlatedExecutions(tx, receipt.requestId);

  return (
    runs.length > 0 &&
    runs.every(
      (run) =>
        (run.status === 'completed' && run.outcome === 'failure') || run.status === 'cancelled'
    )
  );
}

/** Attachment-only and manually classified notes never consume background detection work. */
function questionEligible(message: ChatMessage) {
  const text =
    message.versions.find((version) => version.id === message.activeVersionId)?.text ?? '';

  return (
    message.role === 'user' &&
    message.format !== 'document' &&
    message.question?.origin !== 'manual' &&
    !!text.trim()
  );
}

/** A terminal unsuccessful run no longer blocks the next Assistant turn. */
function retireAssistantReplies(tx: Transaction, noteId: NoteId) {
  for (const message of tx.store(MessageStore).messages({ noteId, limit: 100 })) {
    if (message.role !== 'assistant' || !message.activeVersionId) continue;

    const provenance = tx
      .store(ReplyVersionStore)
      .replyVersion({ noteId, messageId: message.id, versionId: message.activeVersionId });

    if (provenance.state !== 'available') continue;

    const receipt = {
      noteId,
      messageId: message.id,
      versionId: message.activeVersionId,
      requestId: provenance.requestId
    };

    if (questionAnswerRetryable(tx, receipt)) tx.store(ReplyStore).abandonReply(receipt);
  }
}

/** Reuses a conversion receipt or commits one new durable request for the captured version. */
function requestConversion(tx: Transaction, input: typeof convertMessageInputSchema.Type) {
  const strategy = Sources.conversionStrategy(input.strategyId);
  const message = tx.store(MessageStore).message(input.messageId);

  if (!canConvertMessage(message, input.expectedActiveVersionId, strategy.supportedInputs))
    throw new StudyError('invalid_input', 'No convertible content');

  requireAvailableNote(tx, message.noteId);
  const { created, ...result } = tx.store(ReplyStore).requestConversion(input);

  if (created) emitReplyRequest(tx, result, 'rewrite');

  return result;
}

/** Schedules eligible saved inputs while retaining their original selected version. */
function scheduleAutomaticConversion(tx: Transaction, message: ChatMessage, strategyId: string) {
  if (tx.store(NoteModeStore).noteMode(message.noteId) === NoteMode.Assistant) return;

  const version = message.versions.find((version) => version.id === message.activeVersionId);

  if (
    !version ||
    version.origin !== 'typed' ||
    !(version.text.includes('\n') || message.parts.some((part) => part.sourceKind === 'pdf'))
  )
    return;

  try {
    const strategy = Sources.conversionStrategy(strategyId);

    if (!canConvertMessage(message, version.id, strategy.supportedInputs)) return;
  } catch (error) {
    if (error instanceof StudyError && error.kind === 'unsupported') return;

    throw error;
  }

  requestConversion(tx, {
    messageId: message.id,
    expectedActiveVersionId: version.id,
    strategyId
  });
}

function askUserTarget(
  context: Pick<typeof runSelectionContextSchema.Type, 'messages' | 'throughMessageId'>
) {
  return context.messages.find((message) => message.messageId === context.throughMessageId);
}
