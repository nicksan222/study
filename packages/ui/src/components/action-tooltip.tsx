import type { ComponentProps, ReactNode } from 'react';

import { Tooltip, TooltipPopup, TooltipTrigger } from './tooltip';

import './action-tooltip.css';

/** A wrapper trigger keeps help reachable by hover and keyboard when an action is disabled. */
export function ActionTooltip({
  label,
  children,
  ...trigger
}: Pick<ComponentProps<'span'>, 'tabIndex' | 'role' | 'aria-label'> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger {...trigger} render={<span className="ui-action-tooltip" />}>
        {children}
      </TooltipTrigger>
      <TooltipPopup role="tooltip">{label}</TooltipPopup>
    </Tooltip>
  );
}
