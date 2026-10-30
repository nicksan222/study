import { Tooltip as Primitive } from '@base-ui/react/tooltip';
import { cn } from '@study/ui/utils';

export const Tooltip = Primitive.Root;

export const TooltipProvider = Primitive.Provider;

export const TooltipTrigger = Primitive.Trigger;

export function TooltipPopup({
  children,
  className,
  side = 'top',
  ...props
}: Primitive.Popup.Props & { side?: Primitive.Positioner.Props['side'] }) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        side={side}
        sideOffset={4}
        collisionPadding={5}
        className="study-tooltip-positioner"
      >
        <Primitive.Popup {...props} className={cn('study-tooltip', className)}>
          <Primitive.Viewport>{children}</Primitive.Viewport>
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
