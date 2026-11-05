import type { ChatMessage } from '@study/contracts/conversations/messages';
import type { VersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Notebook } from '@study/ui/session-workspace';
import { CircleHelp, MessageSquare, ArrowDownToLine, StickyNote } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { jumpToNotebookTarget, notebookTargetId } from './notebook-index';
import { useQuestionActions } from './question-actions.queries';
import { SessionReadError, SessionError } from './status';

type Model = ReturnType<typeof useQuestionActions>;

/** Explicit question controls always target the version the learner is reading. */
export function QuestionActions({
  message,
  versionId
}: {
  message: ChatMessage;
  versionId: VersionId;
}) {
  const { t } = useI18n();
  const model = useQuestionActions(message, versionId);

  if (message.role !== 'user' || message.format === 'document') return null;

  return (
    <>
      <Notebook.Actions aria-label={t('SessionQuestionActions')}>
        <QuestionAnswer model={model} message={message} />
        {model.isQuestion && model.canRetry && (
          <Button size="sm" variant="outline" disabled={model.blocked} onClick={model.submitAnswer}>
            {t('SessionRetryAnswer')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost-muted"
          disabled={model.blocked}
          onClick={() => {
            model.answer.reset();
            model.restore.reset();
            model.mark.mutate(model.isQuestion ? 'note' : 'question');
          }}
        >
          {model.isQuestion ? (
            <StickyNote size={15} aria-hidden="true" />
          ) : (
            <CircleHelp size={15} aria-hidden="true" />
          )}
          {t(model.isQuestion ? 'SessionMarkAsNote' : 'SessionMarkAsQuestion')}
        </Button>
      </Notebook.Actions>
      <QuestionFeedback model={model} />
    </>
  );
}

/** Restores archived answers or navigates to their authoritative persisted identity. */
function QuestionAnswer({ model, message }: { model: Model; message: ChatMessage }) {
  const { t } = useI18n();

  if (!model.isQuestion) return null;

  const answerId = model.question?.answerMessageId;

  if (answerId)
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={model.restore.isPending}
        onClick={() => {
          if (model.question?.answerArchived) model.restore.mutate();
          else jumpToNotebookTarget(notebookTargetId(message.sessionId, 'message', answerId));
        }}
      >
        <ArrowDownToLine size={15} aria-hidden="true" />
        {t(model.question?.answerArchived ? 'SessionRestoreAnswer' : 'SessionViewAnswer')}
      </Button>
    );

  return (
    <Button size="sm" variant="outline" disabled={model.blocked} onClick={model.submitAnswer}>
      <MessageSquare size={15} aria-hidden="true" />
      {t(model.answer.isPending ? 'SessionRequestingAnswer' : 'SessionAnswerQuestion')}
    </Button>
  );
}

/** Keeps read failures and retriable mutations beside the question they affect. */
function QuestionFeedback({ model }: { model: Model }) {
  return (
    <>
      {model.execution.error && (
        <SessionReadError
          error={model.execution.error}
          retry={() => void model.execution.refetch()}
        />
      )}
      {model.error && <SessionError error={model.error} retry={model.retry} />}
    </>
  );
}
