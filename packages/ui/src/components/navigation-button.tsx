import { BackIcon, NextIcon } from '@study/icons';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from './button';

type NavigationProps = Omit<ComponentProps<typeof Button>, 'children'> & { label: ReactNode };

/** Previous and next actions keep icon placement consistent, including submit and link actions. */
export function PreviousButton({ label, variant = 'outline', ...props }: NavigationProps) {
  return (
    <Button type="button" {...props} variant={variant}>
      <BackIcon aria-hidden="true" />
      {label}
    </Button>
  );
}

export function NextButton({ label, variant = 'outline', ...props }: NavigationProps) {
  return (
    <Button type="button" {...props} variant={variant}>
      {label}
      <NextIcon aria-hidden="true" />
    </Button>
  );
}
