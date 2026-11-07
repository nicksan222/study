import { assistantToolNameSchema } from '@study/contracts/ai/assistant-tools';
import type { agentToolProgressSchema } from '@study/contracts/ai/progress';
import type { ChatMessage } from '@study/contracts/conversations/messages';
import { RetryButton } from '@study/ui/action-button';
import { ToolActivity } from '@study/ui/tool-activity';
import { Schema } from 'effect';

import { useI18n } from '#web/lib/i18n.tsx';

import { toolLabels } from './tool-labels';
import { useToolActivity } from './use-tool-activity';

export function AssistantToolActivity({ message }: { message: ChatMessage }) {
  const model = useToolActivity(message);
  const { t } = useI18n();

  if (!model.tools.length && !model.error) return null;

  return (
    <ToolActivity.List aria-label={t('AssistantActivity')}>
      {model.tools.map((tool) => (
        <Call key={tool.activityId} tool={tool} />
      ))}
      {model.error && (
        <ToolActivity.Note>
          {t('AssistantActivityUnavailable')}{' '}
          <RetryButton size="sm" variant="ghost-muted" label={t('Retry')} onClick={model.retry} />
        </ToolActivity.Note>
      )}
    </ToolActivity.List>
  );
}

const states = {
  running: 'AssistantToolWorking',
  completed: 'AssistantToolDone',
  failed: 'AssistantToolError',
  cancelled: 'AssistantToolCancelled'
} as const;

function Call({ tool }: { tool: typeof agentToolProgressSchema.Type }) {
  const { t } = useI18n();
  const key = Schema.is(assistantToolNameSchema)(tool.toolName)
    ? toolLabels[tool.toolName]
    : 'AssistantToolOther';

  return (
    <ToolActivity.Call label={t(key)} status={tool.status} stateLabel={t(states[tool.status])}>
      <ToolActivity.Name>{tool.toolName}</ToolActivity.Name>
      <CallTiming tool={tool} />
      <CallDetails tool={tool} />
    </ToolActivity.Call>
  );
}

function CallDetails({ tool }: { tool: typeof agentToolProgressSchema.Type }) {
  const { t } = useI18n();

  return (
    <>
      {' '}
      {tool.input && (
        <ToolActivity.Detail
          label={t('AssistantToolInput')}
          text={tool.input.text}
          notice={tool.input.truncated ? t('AssistantToolTruncated') : undefined}
        />
      )}
      {tool.output && (
        <ToolActivity.Detail
          label={t('AssistantToolOutput')}
          text={tool.output.text}
          notice={tool.output.truncated ? t('AssistantToolTruncated') : undefined}
        />
      )}
      <CallOutcome tool={tool} />
    </>
  );
}

function CallOutcome({ tool }: { tool: typeof agentToolProgressSchema.Type }) {
  const { t } = useI18n();

  return (
    <>
      {' '}
      {tool.errorKind && (
        <ToolActivity.Note>
          {t('AssistantToolErrorKind')}: <ToolActivity.Name>{tool.errorKind}</ToolActivity.Name>
        </ToolActivity.Note>
      )}
      {!tool.input && !tool.output && (
        <ToolActivity.Note>{t('AssistantToolNoDetails')}</ToolActivity.Note>
      )}
      {!tool.output && (tool.status === 'failed' || tool.status === 'cancelled') && (
        <ToolActivity.Note>{t('AssistantToolNoOutput')}</ToolActivity.Note>
      )}
    </>
  );
}

function CallTiming({ tool }: { tool: typeof agentToolProgressSchema.Type }) {
  const { t, number } = useI18n();

  if (tool.startedAtMs === undefined || tool.finishedAtMs === undefined) return null;

  const seconds = number(Math.max(0, Number(tool.finishedAtMs - tool.startedAtMs) / 1000), {
    maximumFractionDigits: 2
  });

  return <ToolActivity.Note>{t('AssistantToolElapsed', { seconds })}</ToolActivity.Note>;
}
