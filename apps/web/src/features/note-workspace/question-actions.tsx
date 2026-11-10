import type { VersionId } from '@study/contracts/ids';
import type { ChatMessage } from '@study/contracts/notes/messages';
import { IconButton } from '@study/ui/icon-button';
import { Tooltip, TooltipTrigger, TooltipPopup } from '@study/ui/tooltip';
import { MessageSquare, ArrowDownToLine, StickyNote } from 'lucide-react';
import type { ReactNode } from 'react';

import { AiReadinessNotice } from '#web/lib/ai-readiness-notice.tsx';
import { useI18n } from '#web/lib/i18n.tsx';

import { jumpToNotebookTarget, notebookTargetId } from './notebook-index';
import { PendingMessageWork } from './pending-message-work';
import { useQuestionActions } from './question-actions.queries';
import { NoteReadError, NoteError } from './status';

type Model = ReturnType<typeof useQuestionActions>;

/** Explicit question controls always target the version the learner is reading. */
export function QuestionActions({
  message,
  versionId,
  children
}: {
  message: ChatMessage;
  versionId: VersionId;
  children: (questionActions: ReactNode) => ReactNode;
}) {
  const model = useQuestionActions(message, versionId);

  if (message.role !== 'user' || message.format === 'document') return children(null);

  return (
    <>
      {children(
        <>
          <QuestionResponse model={model} message={message} />
          <QuestionKindAction model={model} />
        </>
      )}
      {model.answering && model.answerVersion && (
        <PendingMessageWork
          noteId={message.noteId}
          messageId={message.id}
          versionId={model.answerVersion.id}
        />
      )}
      {model.isQuestion && <AiReadinessNotice state={model.readiness} />}
      <QuestionFeedback model={model} />
    </>
  );
}

function QuestionResponse({ model, message }: { model: Model; message: ChatMessage }) {
  const { t } = useI18n();

  if (
    !model.isQuestion ||
    model.answering ||
    (model.inPlaceAnswer && model.answerVersion?.status === 'complete')
  )
    return null;

  return (
    <>
      {model.canRetry ? (
        <QuestionToolbarButton
          label={t('NoteRetryAnswer')}
          disabled={model.blocked || model.readiness !== 'ready'}
          onClick={model.submitAnswer}
        >
          <MessageSquare size={15} aria-hidden="true" />
        </QuestionToolbarButton>
      ) : (
        <QuestionAnswer model={model} message={message} />
      )}
    </>
  );
}

function QuestionKindAction({ model }: { model: Model }) {
  const { t } = useI18n();
  const label = t(model.isQuestion ? 'NoteMarkAsNote' : 'NoteMarkAsQuestion');

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton
            size="icon-sm"
            variant="ghost"
            label={label}
            disabled={model.blocked || (!model.isQuestion && model.readiness !== 'ready')}
            onClick={model.submitMark}
          />
        }
      >
        {model.isQuestion ? (
          <StickyNote size={15} aria-hidden="true" />
        ) : (
          <MessageSquare size={15} aria-hidden="true" />
        )}
      </TooltipTrigger>
      <TooltipPopup>{model.isQuestion ? label : t('NoteMarkAsQuestionHelp')}</TooltipPopup>
    </Tooltip>
  );
}

/** Restores archived answers or navigates to their authoritative persisted identity. */
function QuestionAnswer({ model, message }: { model: Model; message: ChatMessage }) {
  const { t } = useI18n();

  if (!model.isQuestion) return null;

  const answerId = model.question?.answerMessageId;

  if (answerId)
    return (
      <QuestionToolbarButton
        label={t(model.question?.answerArchived ? 'NoteRestoreAnswer' : 'NoteViewAnswer')}
        disabled={model.restore.isPending}
        onClick={() => {
          if (model.question?.answerArchived) model.restore.mutate();
          else jumpToNotebookTarget(notebookTargetId(message.noteId, 'message', answerId));
        }}
      >
        <ArrowDownToLine size={15} aria-hidden="true" />
      </QuestionToolbarButton>
    );

  return (
    <QuestionToolbarButton
      label={t(model.answer.isPending ? 'NoteRequestingAnswer' : 'NoteAnswerQuestion')}
      disabled={model.blocked || model.readiness !== 'ready'}
      onClick={model.submitAnswer}
    >
      <MessageSquare size={15} aria-hidden="true" />
    </QuestionToolbarButton>
  );
}

function QuestionToolbarButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton
            size="icon-sm"
            variant="ghost"
            label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** Keeps read failures and retriable mutations beside the question they affect. */
function QuestionFeedback({ model }: { model: Model }) {
  return (
    <>
      {model.execution.error && (
        <NoteReadError error={model.execution.error} retry={() => void model.execution.refetch()} />
      )}
      {model.error && <NoteError error={model.error} retry={model.retry} />}
    </>
  );
}
