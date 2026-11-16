/** @file Owns requests within this feature. */

import type {
  NoteId,
  askInputSchema,
  assistantAskInputSchema,
  convertMessageInputSchema,
  reanswerInputSchema,
  replyRequestInputSchema,
  rewriteMessageInputSchema,
  runSelectionContextSchema
} from '@study/contracts';
import { NoteMode, StudyError } from '@study/contracts';
import { text } from '@study/localization';
import { transaction, impactToken } from '@study/server';
import type { Transaction } from '@study/server';
import { Effect, Option } from 'effect';

import { NoteModeStore } from '#server/features/notes/store/assistant';
import { NoteContextIntentStore } from '#server/features/notes/store/context-intents';
import { NoteStore } from '#server/features/notes/store/index';
import { MessageStore } from '#server/features/notes/store/message';
import { ReplyStore } from '#server/features/notes/store/reply-operations';
import { ReplyRequestStore } from '#server/features/notes/store/reply-requests';
import { ReplyVersionStore } from '#server/features/notes/store/reply-versions';
import { NoteSelectionStore } from '#server/features/notes/store/selection';

import { makeAssistantNotes } from './assistant.ts';
import { assertCapturedTarget, captureContext } from './context.ts';
import { emitReplyRequest } from './generation-events.ts';
import { postMessage } from './messages.ts';
import { readWorkspacePreferences } from './preferences.ts';
import { questionAnswerRetryable, retainExplicitQuestionAnswer } from './questions.ts';
import {
  requestConversion,
  requestTarget,
  scheduleAutomaticConversion
} from './request-targets.ts';

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

function askUserTarget(
  context: Pick<typeof runSelectionContextSchema.Type, 'messages' | 'throughMessageId'>
) {
  return context.messages.find((message) => message.messageId === context.throughMessageId);
}

export function* noteRequestOperations() {
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
    ...assistant,
    ask,
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
      transaction((tx) => requestTarget(tx, input))
  };
}
