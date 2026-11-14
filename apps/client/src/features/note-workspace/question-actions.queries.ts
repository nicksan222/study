import { isRetryable } from '@study/contracts/errors';
import type { VersionId } from '@study/contracts/ids';
import type { ChatMessage } from '@study/contracts/notes/messages';
import { rpc } from '@study/contracts/react';
import type { executionSchema } from '@study/contracts/workflows/schemas';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import { toStudyError } from '#client/lib/study-client/errors.ts';

/** Shares version-bound question mutations and polls only active answer executions. */
export function useQuestionActions(message: ChatMessage, versionId: VersionId) {
  const readiness = useAiReadiness('medium');
  const target = { messageId: message.id, expectedActiveVersionId: versionId };
  const answerOperation = rpc.notes.answerQuestion.useMutation();
  const markOperation = rpc.notes.setMessageKind.useMutation();
  const restoreOperation = rpc.notes.setItemArchived.useMutation();
  const answer = {
    ...answerOperation,
    mutate: () => {
      void answerOperation.mutate(questionAnswerTarget(message, versionId)).catch(() => {});
    }
  };
  const mark = {
    ...markOperation,
    variables: markOperation.variables?.kind,
    mutate: (kind: 'note' | 'question') => {
      void markOperation.mutate({ ...target, kind }).catch(() => {});
    }
  };
  const restore = {
    ...restoreOperation,
    mutate: () => {
      const id = message.question?.answerMessageId;

      if (id)
        void restoreOperation
          .mutate({ noteId: message.noteId, target: { kind: 'message', id }, archived: false })
          .catch(() => {});
    }
  };
  const state = questionActionState(
    message,
    versionId,
    [answer, mark, restore].some((action) => action.isPending)
  );
  const requestId = state.question?.answerRequestId;
  const executionPage = rpc.workflows.executions.useQuery(
    requestId ? { correlationId: requestId, limit: 30 } : undefined
  );
  const execution = { ...executionPage, data: executionPage.data?.items[0] };
  const canRetry = answerExecutionRetryable(execution.data);
  const answerState = questionAnswerState(message, state.question, canRetry);
  const blocked = state.blocked || answerState.answering;
  const error = [answer.error, mark.error, restore.error].find((value) => value != null);
  const submitAnswer = () => {
    if (readiness !== 'ready') return;

    mark.reset();
    restore.reset();
    answer.mutate();
  };
  const retryNeedsAi = questionRetryNeedsAi(answer, mark);
  const retry = questionErrorRetryable(blocked || (retryNeedsAi && readiness !== 'ready'), error)
    ? () => retryQuestionAction({ answer, mark, restore })
    : undefined;

  return {
    answer,
    readiness,
    mark,
    restore,
    canRetry,
    execution,
    ...state,
    blocked,
    ...answerState,
    error,
    submitAnswer,
    submitMark: () => {
      if (!state.isQuestion && readiness !== 'ready') return;

      answer.reset();
      restore.reset();
      mark.mutate(state.isQuestion ? 'note' : 'question');
    },
    retry
  };
}

function questionAnswerTarget(message: ChatMessage, versionId: VersionId) {
  return {
    messageId: message.id,
    expectedActiveVersionId: message.question?.versionId ?? versionId
  };
}

function questionAnswerState(
  message: ChatMessage,
  question: ChatMessage['question'],
  canRetry: boolean
) {
  const answerVersion = message.versions.find(
    (version) => version.id === question?.answerVersionId
  );
  const inPlaceAnswer = question?.answerMessageId === message.id;
  const answering =
    inPlaceAnswer && !!answerVersion && answerVersion.status !== 'complete' && !canRetry;

  return { answerVersion, inPlaceAnswer, answering };
}

/** Retries the failed operation with its original version and classification intent. */
function retryQuestionAction({
  answer,
  mark,
  restore
}: Pick<ReturnType<typeof useQuestionActions>, 'answer' | 'mark' | 'restore'>): void {
  if (answer.error) answer.mutate();
  else if (mark.error && mark.variables) mark.mutate(mark.variables);
  else if (restore.error) restore.mutate();
}

/** Limits question controls to complete current content while a mutation owns submission. */
function questionActionState(message: ChatMessage, versionId: VersionId, pending: boolean) {
  const question =
    message.question?.versionId === versionId || message.question?.answerVersionId === versionId
      ? message.question
      : undefined;
  const version = message.versions.find((item) => item.id === versionId);

  return {
    question,
    isQuestion: question?.kind === 'question',
    blocked: pending || versionId !== message.activeVersionId || version?.status !== 'complete'
  };
}

/** Exposes retry only for transient failures on an available question version. */
function questionErrorRetryable(blocked: boolean, error: unknown) {
  return !blocked && !!error && isRetryable(toStudyError(error).kind);
}

function questionRetryNeedsAi(
  answer: { error: unknown },
  mark: { error: unknown; variables?: 'note' | 'question' }
) {
  return !!answer.error || (!!mark.error && mark.variables === 'question');
}

function answerExecutionRetryable(execution: typeof executionSchema.Type | undefined) {
  return execution?.outcome === 'failure' || execution?.status === 'cancelled';
}
