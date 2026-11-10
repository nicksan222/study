import { CircleAlert, CirclePause, Square, Sparkles } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { observeVisibleAnimation } from '../visible-animation';
import { ActionTooltip } from './action-tooltip';
import { Button } from './button';

export function AiIcon({ working = false }: { working?: boolean }) {
  return (
    <span
      className="ui-ai-icon"
      data-working={working}
      ref={working ? observeVisibleAnimation : undefined}
      aria-hidden="true"
    >
      <Sparkles />
    </span>
  );
}

/** One AI action with task-specific hover feedback, including while disabled. */
export function AiButton({
  label,
  workingLabel = label,
  pending = false,
  children,
  disabled,
  disabledReason,
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label'> & {
  label: string;
  workingLabel?: string;
  pending?: boolean;
  disabledReason?: string;
}) {
  const description = pending ? workingLabel : disabled && disabledReason ? disabledReason : label;

  return (
    <ActionTooltip
      label={description}
      tabIndex={disabled ? 0 : undefined}
      aria-label={disabled ? label : undefined}
    >
      <Button
        {...props}
        disabled={disabled}
        aria-label={label}
        aria-busy={pending}
        data-ai-working={pending}
      >
        <AiIcon working={pending} />
        {children}
      </Button>
      {pending && (
        <span className="sr-only" role="status" aria-live="polite">
          {workingLabel}
        </span>
      )}
    </ActionTooltip>
  );
}

/** Work always names its current state; only active execution animates. */
export function AiActivity({
  label,
  action,
  state = 'running'
}: {
  label: string;
  action?: ReactNode;
  state?: 'running' | 'waiting' | 'stopping' | 'attention';
}) {
  return (
    <span className="ui-ai-activity">
      <span
        className="ui-ai-activity-status"
        role="status"
        aria-label={label}
        aria-atomic="true"
        data-state={state}
      >
        {state === 'running' ? (
          <AiIcon working />
        ) : state === 'waiting' ? (
          <CirclePause aria-hidden="true" />
        ) : state === 'attention' ? (
          <CircleAlert aria-hidden="true" />
        ) : (
          <Square aria-hidden="true" />
        )}
        <span>{label}</span>
      </span>
      {action}
    </span>
  );
}
