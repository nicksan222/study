import type { ChatMessage } from '@study/contracts/conversations/messages';
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

import { useI18n } from '#web/lib/i18n.tsx';

import { AgentToolCall } from '../agent-progress';
import { AssistantToolDetails } from './tool-details';
import { useToolActivity } from './use-tool-activity';

export function AssistantToolActivity({ message }: { message: ChatMessage }) {
  const model = useToolActivity(message);
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean>();
  const running = model.tools.some((tool) => tool.status === 'running');
  const failed = model.tools.some((tool) => tool.status === 'failed');
  const stopped = model.tools.some((tool) => tool.status === 'cancelled');
  const label = running
    ? 'AssistantActivityRunning'
    : failed
      ? 'AssistantActivityFailed'
      : stopped
        ? 'AssistantActivityStopped'
        : 'AssistantActivityCompleted';
  const Icon = running ? Circle : failed ? CircleAlert : stopped ? X : Check;

  if (!model.tools.length)
    return model.error ? (
      <ToolActivity.Note>
        {t('AssistantActivityUnavailable')}{' '}
        <RetryButton size="sm" variant="ghost-muted" label={t('Retry')} onClick={model.retry} />
      </ToolActivity.Note>
    ) : null;

  return (
    <Trace aria-label={t('AssistantActivity')}>
      <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? 'running' : failed ? 'error' : undefined}>
            <TraceIcon>
              <Icon />
            </TraceIcon>
            <TraceTitle>{t(label, { count: model.tools.length })}</TraceTitle>
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
            {model.error && (
              <ToolActivity.Note>
                {t('AssistantActivityUnavailable')}{' '}
                <RetryButton
                  size="sm"
                  variant="ghost-muted"
                  label={t('Retry')}
                  onClick={model.retry}
                />
              </ToolActivity.Note>
            )}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
