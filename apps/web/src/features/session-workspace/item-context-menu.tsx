import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem
} from '@study/ui/context-menu';
import { ArrowUpRight } from 'lucide-react';
import { cloneElement, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

export function ItemContextMenu({
  children,
  target,
  label,
  disabled = false
}: {
  children: ReactNode;
  target: ReactElement<{ 'aria-label'?: string }>;
  label: string;
  disabled?: boolean;
}) {
  const trigger = useRef<HTMLDivElement>(null);

  return (
    <ContextMenu>
      <ContextMenuTrigger ref={trigger} render={<div />} tabIndex={-1}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuPopup
        finalFocus={() => trigger.current?.querySelector<HTMLElement>('button, a') ?? null}
      >
        <ContextMenuItem render={cloneElement(target, { 'aria-label': label })} disabled={disabled}>
          <ArrowUpRight aria-hidden="true" />
          {label}
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}
