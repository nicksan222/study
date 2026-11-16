import { LoadingIcon } from '@study/icons';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';

import { cn } from '../utils.ts';
import { observeVisibleAnimation } from '../visible-animation.ts';

// No default size: inside a Button the parent's svg rule sizes the glyph.
const spinnerVariants = cva('motion-safe:visible-animate-spin', {
  variants: {
    size: {
      xs: 'size-3',
      sm: 'size-3.5',
      md: 'size-4',
      lg: 'size-5'
    },
    tone: {
      current: '',
      muted: 'text-muted-foreground'
    }
  },
  defaultVariants: { tone: 'current' }
});

function Spinner({
  className,
  size,
  tone,
  label,
  ...props
}: React.ComponentPropsWithoutRef<typeof LoadingIcon> &
  VariantProps<typeof spinnerVariants> & { label: string }) {
  return (
    <LoadingIcon
      aria-label={label}
      ref={observeVisibleAnimation}
      className={cn(spinnerVariants({ size, tone }), className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
