import type { ChatMessage } from '@study/contracts/notes/messages';
import { RetryButton } from '@study/ui/action-button';
import { ToolActivity } from '@study/ui/tool-activity';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '@study/ui/trace';
import { Check, Circle, CircleAlert, X } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { AgentToolCall } from '../agent-progress';
import { AssistantToolDetails } from './tool-details';
import { useToolActivity } from './use-tool-activity';

export function AssistantToolActivity({ message }: { message: ChatMessage }) {
  const model = useToolActivity(message);
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean>();
  const summary = activitySummary(model.tools);
  const running = summary.status === 'running';
  const Icon = summary.Icon;

  if (!model.tools.length) return <ActivityRetry failed={model.error} retry={model.retry} />;

  return (
    <Trace aria-label={t('AssistantActivity')}>
      <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={summary.status}>
            <TraceIcon>
              <Icon />
            </TraceIcon>
            <TraceTitle>{t(summary.label, { count: model.tools.length })}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace density="compact">
            {model.tools.map((tool) => (
              <AgentToolCall
                key={tool.activityId}
                tool={tool}
                details={<AssistantToolDetails tool={tool} />}
              />
            ))}
            <ActivityRetry failed={model.error} retry={model.retry} />
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** In-progress calls take precedence over terminal failures and cancellations. */
function activitySummary(tools: ReturnType<typeof useToolActivity>['tools']) {
  if (tools.some((tool) => tool.status === 'running'))
    return { label: 'AssistantActivityRunning', Icon: Circle, status: 'running' } as const;

  if (tools.some((tool) => tool.status === 'failed'))
    return { label: 'AssistantActivityFailed', Icon: CircleAlert, status: 'error' } as const;

  if (tools.some((tool) => tool.status === 'cancelled'))
    return { label: 'AssistantActivityStopped', Icon: X, status: undefined } as const;

  return { label: 'AssistantActivityCompleted', Icon: Check, status: undefined } as const;
}

function ActivityRetry({ failed, retry }: { failed: boolean; retry: () => void }) {
  const { t } = useI18n();

  if (!failed) return null;

  return (
    <ToolActivity.Note>
      {t('AssistantActivityUnavailable')}{' '}
      <RetryButton size="sm" variant="ghost-muted" label={t('Retry')} onClick={retry} />
    </ToolActivity.Note>
  );
}
