import type { MessageId } from '@study/contracts/ids';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { RichNoteContent } from '@study/ui/rich-note';
import { Notebook } from '@study/ui/session-workspace';

import { useI18n } from '#web/lib/i18n.tsx';

import { useReply } from './use-reply';

type ReplyModel = ReturnType<typeof useReply>;

/** Live previews never replace committed messages; reconnects resume the durable progress snapshot. */
export function AssistantReply({
  requestId,
  messageId
}: {
  requestId: string;
  messageId: MessageId;
}) {
  const model = useReply(requestId, messageId);
  const { t } = useI18n();

  return (
    <>
      <ReplyText model={model} />
      <ReplyFailure model={model} />
      {model.actionError && <ErrorState layout="inline" title={t('AssistantActionFailed')} />}
      {model.canStop && (
        <Button size="sm" variant="ghost" disabled={model.stopping} onClick={model.stop}>
          {t('AssistantStop')}
        </Button>
      )}
    </>
  );
}

function ReplyText({ model }: { model: ReplyModel }) {
  const { t } = useI18n();

  return (
    <>
      {model.run?.text ? (
        <RichNoteContent value={model.run.text} streaming={model.run.status === 'running'} />
      ) : (
        !model.failed && (
          <Loading label={t(model.needsSignIn ? 'AssistantSignIn' : 'AssistantThinking')} />
        )
      )}
      <ToolStatus model={model} />
      {model.reconnecting && (
        <Notebook.Status role="status">{t('AgentStreamReconnecting')}</Notebook.Status>
      )}
    </>
  );
}

function ReplyFailure({ model }: { model: ReplyModel }) {
  const { t } = useI18n();

  if (!model.failed) return null;

  return (
    <ErrorState
      layout="inline"
      title={t(model.stopped ? 'AssistantStopped' : 'AssistantReplyFailed')}
      description={model.auth ? t('AssistantSignIn') : undefined}
      action={
        <RetryButton
          size="sm"
          variant="outline"
          label={t('Retry')}
          disabled={model.retrying}
          onClick={model.retry}
        />
      }
    />
  );
}

function ToolStatus({ model }: { model: ReplyModel }) {
  const { t } = useI18n();
  const tool = model.run?.tools.at(-1);

  if (!tool) return null;

  const labels = {
    running: 'AgentToolRunning',
    completed: 'AgentToolCompleted',
    failed: 'AgentToolFailed',
    cancelled: 'AgentToolFailed'
  } as const;

  return <Notebook.Status role="status">{t(labels[tool.status])}</Notebook.Status>;
}
