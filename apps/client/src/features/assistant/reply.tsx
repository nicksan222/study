import type { MessageId } from '@study/contracts';
import { StopIcon } from '@study/icons';
import { RetryButton, AiActivity, Button, ErrorState, RichNoteContent } from '@study/ui';

import { AiReadinessNotice } from '#client/lib/ai-readiness-notice.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

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
      {model.failed && <AiReadinessNotice state={model.readiness} />}
      {model.actionError && <ErrorState layout="inline" title={t('AssistantActionFailed')} />}
      {model.canStop && (
        <Button size="sm" variant="outline" disabled={model.stopping} onClick={model.stop}>
          <StopIcon size={16} aria-hidden="true" />
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
          <AssistantThinking
            label={t(
              model.needsSignIn
                ? 'AssistantSignIn'
                : model.compacting
                  ? 'AssistantCompacting'
                  : 'AssistantThinking'
            )}
          />
        )
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
      description={
        model.auth
          ? t('AssistantSignIn')
          : model.stopped
            ? undefined
            : t('AssistantReplyFailedDescription')
      }
      action={
        <RetryButton
          variant="outline"
          label={t('AssistantSendAgain')}
          disabled={model.retrying || model.readiness !== 'ready'}
          onClick={model.retry}
        />
      }
    />
  );
}

export function AssistantThinking({ label }: { label: string }) {
  return <AiActivity label={label} />;
}
