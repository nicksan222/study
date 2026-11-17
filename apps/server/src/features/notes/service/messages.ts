/** @file Owns messages within this feature. */

import type {
  MessageId,
  NoteId,
  ProjectId,
  SourceId,
  editMessageInputSchema,
  postMessageInputSchema,
  setActiveVersionInputSchema,
  threadInputSchema,
  updateMessageDescriptionInputSchema
} from '@study/contracts';
import { StudyError } from '@study/contracts';
import { mentionLabel } from '@study/localization';
import { publicationTransaction, transaction } from '@study/server';
import type { Transaction } from '@study/server';
import { Effect } from 'effect';

import { MessageStore } from '#server/features/notes/store/message';
import { RecordingPostStore } from '#server/features/notes/store/recording';
import { ReplyStore } from '#server/features/notes/store/reply-operations';
import { Sources } from '#server/features/sources/index';

import { requireAvailableNote } from './availability.ts';
import { resolveMessageCitations } from './citations.ts';
import { captureContext } from './context.ts';
import { scheduleAutomaticTitle } from './generation-events.ts';
import { readWorkspacePreferences } from './preferences.ts';
import { retainExplicitQuestionAnswer, scheduleQuestion } from './questions.ts';
import { scheduleAutomaticConversion } from './request-targets.ts';
import { scheduleSectionTitle } from './section-titles.ts';

/** Recognizes whole assistant mention tokens without matching identifier suffixes. */
function mentionsAssistant(text: string) {
  return [...text.matchAll(/(?:^|\s)(@[\p{L}\p{M}\p{N}_]+)/gu)].some(
    (match) => match[1]!.toLowerCase() === mentionLabel('assistant')
  );
}

/** Source membership is independent of the raw message that introduced it. */
export function postMessage(tx: Transaction, input: typeof postMessageInputSchema.Type) {
  const message = tx.store(MessageStore).postMessage(input);

  scheduleQuestion(tx, message);
  scheduleSectionTitle(tx, message);

  for (const sourceId of input.sourceIds ?? [])
    Sources.attachInTransaction(tx, { noteId: input.noteId, sourceId });

  return message;
}

export function noteMessageOperations() {
  return {
    message: (id: MessageId) =>
      transaction((tx) => resolveMessageCitations(tx, tx.store(MessageStore).message(id))),
    thread: (input: typeof threadInputSchema.Type) =>
      transaction((tx) => {
        const messages = tx.store(MessageStore);

        const items = messages.messages(input);

        for (const message of items) scheduleSectionTitle(tx, message);

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
        scheduleSectionTitle(tx, edited);

        return resolveMessageCitations(tx, edited);
      }),
    editMessage: (input: typeof editMessageInputSchema.Type) =>
      transaction((tx) => {
        const message = tx.store(MessageStore).editMessage(input);

        scheduleQuestion(tx, message);
        scheduleSectionTitle(tx, message);

        return resolveMessageCitations(tx, message);
      }),
    /** Preserves classification on no-op selections and requeues changed content versions. */
    setActiveVersion: (input: typeof setActiveVersionInputSchema.Type) =>
      transaction((tx) => {
        const previous = tx.store(MessageStore).message(input.messageId).activeVersionId;
        const message = tx.store(MessageStore).setActiveVersion(input);

        if (previous !== message.activeVersionId) {
          scheduleQuestion(tx, message, true);
          scheduleSectionTitle(tx, message);
        }

        return resolveMessageCitations(tx, message);
      }),
    /** Reclassifies only when version deletion selects different active content. */
    deleteMessageVersion: (input: typeof setActiveVersionInputSchema.Type) =>
      transaction((tx) => {
        const previous = tx.store(MessageStore).message(input.messageId).activeVersionId;
        const message = tx.store(MessageStore).deleteMessageVersion(input);

        if (previous !== message.activeVersionId) {
          scheduleQuestion(tx, message, true);
          scheduleSectionTitle(tx, message);
        }

        return resolveMessageCitations(tx, message);
      }),
    deleteMessage: (id: MessageId) => transaction((tx) => tx.store(MessageStore).deleteMessage(id))
  };
}
