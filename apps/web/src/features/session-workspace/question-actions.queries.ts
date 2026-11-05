import type { ChatMessage } from '@study/contracts/conversations/messages';
import { isRetryable } from '@study/contracts/errors';
import type { VersionId } from '@study/contracts/ids';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { executionOptions, sessionKey } from './session-workspace.queries';

export function useQuestionActions(message: ChatMessage, versionId: VersionId) {
  const cache = useQueryClient();
  const target = { messageId: message.id, expectedActiveVersionId: versionId };
  const refresh = () => cache.invalidateQueries({ queryKey: sessionKey(message.sessionId) });
  const answer = useMutation({
    mutationFn: () => request((client) => client['conversations.answerQuestion'](target)),
    retry: false,
    onSettled: refresh
  });
  const mark = useMutation({
    mutationFn: (kind: 'note' | 'question') =>
      request((client) => client['conversations.setMessageKind']({ ...target, kind })),
    retry: false,
    onSettled: refresh
  });

  const restore = useMutation({
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
    select: (page) => page.items[0]
  });
  const canRetry = execution.data?.outcome === 'failure' || execution.data?.status === 'cancelled';
  const error = [answer.error, mark.error, restore.error].find((value) => value !== null);
  const submitAnswer = () => {
    mark.reset();
    restore.reset();
    answer.mutate();
  };
  const retry = questionErrorRetryable(state.blocked, error)
    ? () => retryQuestionAction({ answer, mark, restore })
    : undefined;

  return {
    answer,
    mark,
    restore,
    canRetry,
    execution,
    ...state,
    error,
    submitAnswer,
    retry
  };
}

function retryQuestionAction({
  answer,
  mark,
  restore
}: Pick<ReturnType<typeof useQuestionActions>, 'answer' | 'mark' | 'restore'>): void {
  if (answer.error) answer.mutate();
  else if (mark.error && mark.variables) mark.mutate(mark.variables);
  else if (restore.error) restore.mutate();
}

function questionActionState(message: ChatMessage, versionId: VersionId, pending: boolean) {
  const question = message.question?.versionId === versionId ? message.question : undefined;
  const version = message.versions.find((item) => item.id === versionId);

  return {
    question,
    isQuestion: question?.kind === 'question',
    blocked: pending || versionId !== message.activeVersionId || version?.status !== 'complete'
  };
}

function questionErrorRetryable(blocked: boolean, error: unknown) {
  return !blocked && !!error && isRetryable(toStudyError(error).kind);
}
