import type { ReactNode } from 'react';

import { cn } from '../utils';
import { DialogHeader, DialogTitle, DialogDescription } from './dialog';

/** Dialog title and optional help stay connected to the popup's accessible name and description. */
export function DialogHeading({
  title,
  description,
  density
}: {
  title: ReactNode;
  description?: ReactNode;
  density?: 'compact';
}) {
  return (
    <DialogHeader className={cn(density === 'compact' && 'gap-1 py-4 pr-12')}>
      <DialogTitle className={cn(density === 'compact' && 'text-base')}>{title}</DialogTitle>
      {description && (
        <DialogDescription className={cn(density === 'compact' && 'text-xs')}>
          {description}
        </DialogDescription>
      )}
    </DialogHeader>
  );
}
