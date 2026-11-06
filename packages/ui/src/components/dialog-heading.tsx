import type { ReactNode } from 'react';

import { DialogHeader, DialogTitle, DialogDescription } from './dialog';

/** Dialog title and optional help stay connected to the popup's accessible name and description. */
export function DialogHeading({
  title,
  description
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      {description && <DialogDescription>{description}</DialogDescription>}
    </DialogHeader>
  );
}
