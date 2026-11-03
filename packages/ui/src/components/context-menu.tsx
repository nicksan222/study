import { ContextMenu as Primitive } from '@base-ui/react/context-menu';
import { cn } from '@study/ui/utils';

import { MenuItem, MenuSeparator } from './menu';

export const ContextMenu: typeof Primitive.Root = Primitive.Root;

export const ContextMenuTrigger: typeof Primitive.Trigger = Primitive.Trigger;

export const ContextMenuItem = MenuItem;

export const ContextMenuSeparator = MenuSeparator;

export function ContextMenuPopup({ className, children, ...props }: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner className="study-menu-positioner" sideOffset={4}>
        <Primitive.Popup className={cn('study-menu-popup', className)} {...props}>
          <div className="study-menu-scroll">{children}</div>
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
