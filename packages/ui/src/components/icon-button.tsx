import { Button } from '@study/ui/button';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@study/ui/tooltip';
import type { ComponentProps } from 'react';

export function IconButton({
  label,
  size = 'icon-xs',
  variant = 'ghost',
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label' | 'title'> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button {...props} size={size} variant={variant} aria-label={label} />}
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
