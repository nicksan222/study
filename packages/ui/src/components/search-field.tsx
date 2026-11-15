import { SearchIcon } from '@study/icons';
import type { ReactNode } from 'react';

import { cn } from '../utils.ts';
import { Input } from './input';
import type { InputProps } from './input';

/** Keeps search icons, input sizing and focus treatment consistent across navigation surfaces. */
export function SearchField({
  className,
  trailing,
  ...props
}: Omit<InputProps, 'type' | 'unstyled' | 'children'> & { trailing?: ReactNode }) {
  return (
    <div className={cn('ui-search-field', className)}>
      <SearchIcon aria-hidden="true" />
      <Input {...props} unstyled type="search" />
      {trailing}
    </div>
  );
}
