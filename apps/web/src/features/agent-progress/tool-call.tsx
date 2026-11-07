import { assistantToolNameSchema } from '@study/contracts/ai/assistant-tools';
import type { agentToolProgressSchema } from '@study/contracts/ai/progress';
import { ToolActivity } from '@study/ui/tool-activity';
import {
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
  TraceLine,
  TraceTitle,
  TraceIcon,
  TraceDescription
} from '@study/ui/trace';
import { Schema } from 'effect';
import { Check, Circle, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { toolLabels } from './tool-labels';

const states = {
  running: 'AssistantToolWorking',
  completed: 'AssistantToolDone',
  failed: 'AssistantToolError',
  cancelled: 'AssistantToolCancelled'
} as const;

export function AgentToolCall({
  tool,
  details
}: {
  tool: typeof agentToolProgressSchema.Type;
  details?: ReactNode;
}) {
  const { t } = useI18n();
  const key = Schema.is(assistantToolNameSchema)(tool.toolName)
    ? toolLabels[tool.toolName]
    : 'AssistantToolOther';

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine
          status={
            tool.status === 'running' ? 'running' : tool.status === 'failed' ? 'error' : undefined
          }
        >
          <TraceIcon>
            {tool.status === 'completed' ? (
              <Check />
            ) : tool.status === 'running' ? (
              <Circle />
            ) : (
              <X />
            )}
          </TraceIcon>
          <TraceTitle>{t(key)}</TraceTitle>{' '}
          <TraceDescription accessibleOnly={tool.status === 'completed'}>
            {t(states[tool.status])}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent layout="details">
        <ToolActivity.Metadata>
          <ToolActivity.Name>{tool.toolName}</ToolActivity.Name>
          <CallTiming tool={tool} />
        </ToolActivity.Metadata>
        {details ?? <CallDetails tool={tool} />}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function CallDetails({ tool }: { tool: typeof agentToolProgressSchema.Type }) {
  const { t } = useI18n();

  return (
    <>
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
      <AgentToolOutcome tool={tool} />
    </>
  );
}

export function AgentToolOutcome({ tool }: { tool: typeof agentToolProgressSchema.Type }) {
  const { t } = useI18n();

  return (
    <>
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
