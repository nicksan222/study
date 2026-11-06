import { Sparkles } from 'lucide-react';
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
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label'> & {
  label: string;
  workingLabel?: string;
  pending?: boolean;
}) {
  const description = pending ? workingLabel : label;

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

/** Non-interactive work uses the same animated glyph and tooltip as an AI action. */
export function AiActivity({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <span className="ui-ai-activity">
      <ActionTooltip label={label} tabIndex={0} role="status" aria-label={label}>
        <AiIcon working />
        <span className="sr-only">{label}</span>
      </ActionTooltip>
      {action}
    </span>
  );
}
