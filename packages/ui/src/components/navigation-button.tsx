import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from './button';

type NavigationProps = Omit<ComponentProps<typeof Button>, 'children'> & { label: string };

/** Previous and next actions keep icon placement consistent, including submit and link actions. */
export function PreviousButton({ label, variant = 'outline', ...props }: NavigationProps) {
  return (
    <Button type="button" {...props} variant={variant}>
      <ArrowLeft aria-hidden="true" />
      {label}
    </Button>
  );
}

export function NextButton({ label, variant = 'outline', ...props }: NavigationProps) {
  return (
    <Button type="button" {...props} variant={variant}>
      {label}
      <ArrowRight aria-hidden="true" />
    </Button>
  );
}
