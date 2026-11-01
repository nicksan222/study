import { Tooltip as Primitive } from '@base-ui/react/tooltip';
import { cn } from '@study/ui/utils';

export const TooltipProvider = Primitive.Provider;

export const Tooltip = Primitive.Root;

export const TooltipTrigger = Primitive.Trigger;

export function TooltipPopup({
  children,
  className,
  side = 'top',
  align = 'center',
  sideOffset = 4,
  ...props
}: Primitive.Popup.Props & {
  side?: Primitive.Positioner.Props['side'];
  align?: Primitive.Positioner.Props['align'];
  sideOffset?: Primitive.Positioner.Props['sideOffset'];
}) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={5}
        className="pointer-events-none z-[140] max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
      >
        <Primitive.Popup
          {...props}
          className={cn(
            'relative flex max-w-80 origin-(--transform-origin) wrap-anywhere rounded-md border border-[var(--ui-surface-border)] bg-popover text-balance text-xs leading-snug text-popover-foreground shadow-md/5 transition-[scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] before:shadow-[0_1px_--theme(--color-media-overlay/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0 dark:before:shadow-[0_-1px_--theme(--color-media-foreground/6%)]',
            className
          )}
          data-slot="tooltip-popup"
        >
          <Primitive.Viewport className="min-w-0 px-2 py-1">{children}</Primitive.Viewport>
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
