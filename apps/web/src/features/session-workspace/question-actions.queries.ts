import type { ChatMessage } from '@study/contracts/conversations/messages';
import { isRetryable } from '@study/contracts/errors';
import type { VersionId } from '@study/contracts/ids';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { executionOptions, sessionKey } from './session-workspace.queries';

/** Shares version-bound question mutations and polls only active answer executions. */
export function useQuestionActions(message: ChatMessage, versionId: VersionId) {
  const cache = useQueryClient();
  const key = [...sessionKey(message.sessionId), 'question', String(message.id), String(versionId)];
  const target = { messageId: message.id, expectedActiveVersionId: versionId };
  const refresh = () => cache.invalidateQueries({ queryKey: sessionKey(message.sessionId) });
  const answer = useMutation({
    mutationKey: [...key, 'answer'],
    mutationFn: () =>
      request((client) =>
        client['conversations.answerQuestion'](questionAnswerTarget(message, versionId))
      ),
    retry: false,
    onSettled: refresh
  });
  const mark = useMutation({
    mutationKey: [...key, 'mark'],
    mutationFn: (kind: 'note' | 'question') =>
      request((client) => client['conversations.setMessageKind']({ ...target, kind })),
    retry: false,
    onSettled: refresh
  });

  const restore = useMutation({
    mutationKey: [...key, 'restore'],
    mutationFn: () =>
      request((client) =>
        client['conversations.setItemArchived']({
          sessionId: message.sessionId,
          target: { kind: 'message', id: message.question!.answerMessageId! },
          archived: false
        })
      ),
    retry: false,
    onSettled: refresh
  });
  const state = questionActionState(
    message,
    versionId,
    [answer, mark, restore].some((action) => action.isPending)
  );
  const requestId = state.question?.answerRequestId;
  const execution = useQuery({
    ...executionOptions(requestId ?? ''),
    enabled: !!requestId,
    refetchInterval: (query) => {
      const run = query.state.data?.items[0];

      return run && (run.status === 'completed' || run.status === 'cancelled') ? false : 3000;
    },
    select: (page) => page.items[0]
  });
  const canRetry = execution.data?.outcome === 'failure' || execution.data?.status === 'cancelled';
  const answerState = questionAnswerState(message, state.question, canRetry);
  const blocked = state.blocked || answerState.answering;
  const error = [answer.error, mark.error, restore.error].find((value) => value !== null);
  const submitAnswer = () => {
    mark.reset();
    restore.reset();
    answer.mutate();
  };
  const retry = questionErrorRetryable(blocked, error)
    ? () => retryQuestionAction({ answer, mark, restore })
    : undefined;

  return {
    answer,
    mark,
    restore,
    canRetry,
    execution,
    ...state,
    blocked,
    ...answerState,
    error,
    submitAnswer,
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
