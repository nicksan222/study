import { ContextMenu as Primitive } from '@base-ui/react/context-menu';
import { cn } from '@study/ui/utils';

import { MenuItem, MenuSeparator } from './menu';

export const ContextMenu: typeof Primitive.Root = Primitive.Root;

export function ContextMenuTrigger({
  fill = false,
  className,
  ...props
}: Primitive.Trigger.Props & { fill?: boolean }) {
  return <Primitive.Trigger className={cn(fill && 'h-full', className)} {...props} />;
}

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

export type ItemDeletionActions = {
  onDeleteItem: () => void;
  onDeleteVersion: () => void;
  open: boolean;
  disabled?: boolean;
  versionDisabled?: boolean;
};
