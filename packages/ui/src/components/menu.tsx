import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { cn } from '@study/ui/utils';

export const Menu: typeof MenuPrimitive.Root = MenuPrimitive.Root;

export function MenuTrigger({ className, children, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger className={className} data-slot="menu-trigger" {...props}>
      {children}
    </MenuPrimitive.Trigger>
  );
}

export function MenuPopup({
  children,
  className,
  sideOffset = 4,
  align = 'center',
  alignOffset,
  side = 'bottom',
  anchor,
  portalProps,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props['align'];
  sideOffset?: MenuPrimitive.Positioner.Props['sideOffset'];
  alignOffset?: MenuPrimitive.Positioner.Props['alignOffset'];
  side?: MenuPrimitive.Positioner.Props['side'];
  anchor?: MenuPrimitive.Positioner.Props['anchor'];
  portalProps?: MenuPrimitive.Portal.Props;
}) {
  return (
    <MenuPrimitive.Portal {...portalProps}>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="study-menu-positioner"
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn('study-menu-popup', className)}
          data-slot="menu-popup"
          {...props}
        >
          <div className="study-menu-scroll">{children}</div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <MenuPrimitive.Item
      className={cn('study-menu-item', className)}
      data-inset={inset || undefined}
      data-slot="menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      className={cn('study-menu-separator', className)}
      data-slot="menu-separator"
      {...props}
    />
  );
}
