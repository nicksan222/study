/** @file Owns questions within this feature. */

import type {
  ChatMessage,
  questionClassificationSchema,
  questionVersionInputSchema,
  replyRequestSchema,
  setMessageKindInputSchema
} from '@study/contracts';
import { NoteMode, StudyError } from '@study/contracts';
import { Effect, Option } from 'effect';

import { NoteModeStore } from '#server/features/notes/store/assistant';
import { MessageStore } from '#server/features/notes/store/message';
import { QuestionAnswerStore, QuestionStore } from '#server/features/notes/store/questions';
import { ReplyStore } from '#server/features/notes/store/reply-operations';
import { Workflows } from '#server/features/workflows/index';
import type { Transaction } from '#server/platform/definitions/define-store';
import { publicationTransaction, transaction } from '#server/platform/definitions/define-store';

import { captureContext } from './context.ts';
import { emitReplyRequest } from './generation-events.ts';
import { readWorkspacePreferences } from './preferences.ts';

/** Schedules replay-safe detection only when the saved note is eligible. */
export function scheduleQuestion(tx: Transaction, message: ChatMessage, reclassify = false) {
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
export function retainExplicitQuestionAnswer(
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
export function questionAnswerRetryable(tx: Transaction, receipt: typeof replyRequestSchema.Type) {
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

export function noteQuestionOperations() {
  return {
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
    })
  };
}
