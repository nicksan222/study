import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../utils';

// Adapted from https://ui.shadcn.com/r/styles/base-nova/badge.json.
// MIT license: ../vendor/shadcn/LICENSE.
const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        secondary: 'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive/10 text-destructive-foreground',
        outline: 'border-border text-muted-foreground'
      }
    },
    defaultVariants: { variant: 'secondary' }
  }
);

function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge };
