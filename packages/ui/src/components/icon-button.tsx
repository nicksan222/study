import { Button } from '@study/ui/button';
import type { ComponentProps } from 'react';

import { ActionTooltip } from './action-tooltip';

export function IconButton({
  label,
  size = 'icon-xs',
  variant = 'ghost',
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label' | 'title'> & { label: string }) {
  return (
    <ActionTooltip
      label={label}
      tabIndex={disabled ? 0 : undefined}
      aria-label={disabled ? label : undefined}
    >
      <Button {...props} disabled={disabled} size={size} variant={variant} aria-label={label} />
    </ActionTooltip>
  );
}
