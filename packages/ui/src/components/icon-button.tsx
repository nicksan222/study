import type { ComponentProps } from 'react';

import { ActionTooltip } from './action-tooltip';
import { Button } from './button.tsx';

export function IconButton({
  label,
  tooltip = label,
  size = 'icon-xs',
  variant = 'ghost',
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label' | 'title'> & {
  label: string;
  tooltip?: string;
}) {
  return (
    <ActionTooltip
      label={tooltip}
      tabIndex={disabled ? 0 : undefined}
      aria-label={disabled ? label : undefined}
    >
      <Button {...props} disabled={disabled} size={size} variant={variant} aria-label={label} />
    </ActionTooltip>
  );
}
