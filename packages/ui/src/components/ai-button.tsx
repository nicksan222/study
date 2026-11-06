import { Sparkles } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { observeVisibleAnimation } from '../visible-animation';
import { Button } from './button';
import { Tooltip, TooltipTrigger, TooltipPopup } from './tooltip';

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
    <Tooltip>
      <TooltipTrigger
        tabIndex={disabled ? 0 : undefined}
        render={<span className="ui-ai-trigger" />}
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
      </TooltipTrigger>
      <TooltipPopup role="tooltip">{description}</TooltipPopup>
    </Tooltip>
  );
}

/** Non-interactive work uses the same animated glyph and tooltip as an AI action. */
export function AiActivity({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <span className="ui-ai-activity">
      <Tooltip>
        <TooltipTrigger
          tabIndex={0}
          render={<span className="ui-ai-trigger" role="status" aria-label={label} />}
        >
          <AiIcon working />
          <span className="sr-only">{label}</span>
        </TooltipTrigger>
        <TooltipPopup role="tooltip">{label}</TooltipPopup>
      </Tooltip>
      {action}
    </span>
  );
}
