import { Combobox as Primitive } from '@base-ui/react/combobox';
import { cn } from '@study/ui/utils';
import { Check } from 'lucide-react';
import type * as React from 'react';

import { Input } from './input';

// Single-select pieces adapted from coss/ui's MIT-licensed combobox.
export const Combobox: typeof Primitive.Root = Primitive.Root;

export const createComboboxItems: typeof Primitive.createItems = Primitive.createItems;

export function ComboboxTrigger({ className, ...props }: Primitive.Trigger.Props) {
  return <Primitive.Trigger className={className} data-slot="combobox-trigger" {...props} />;
}

export function ComboboxPopup({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  ...props
}: Primitive.Popup.Props & {
  side?: Primitive.Positioner.Props['side'];
  sideOffset?: Primitive.Positioner.Props['sideOffset'];
  align?: Primitive.Positioner.Props['align'];
}) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className="z-50 outline-none"
        data-slot="combobox-positioner"
      >
        <Primitive.Popup
          className={cn(
            'rounded-lg border border-border bg-popover text-foreground shadow-lg',
            className
          )}
          data-slot="combobox-popup"
          {...props}
        >
          {children}
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}

export function ComboboxInput(
  props: Primitive.Input.Props & { ref?: React.Ref<HTMLInputElement> }
) {
  return <Primitive.Input data-slot="combobox-input" render={<Input nativeInput />} {...props} />;
}

export function ComboboxList({ className, ...props }: Primitive.List.Props) {
  return (
    <Primitive.List
      className={cn(
        'max-h-[min(21rem,var(--available-height))] overflow-y-auto overscroll-contain outline-none',
        className
      )}
      data-slot="combobox-list"
      {...props}
    />
  );
}

export function ComboboxItem({ className, children, ...props }: Primitive.Item.Props) {
  return (
    <Primitive.Item
      className={cn(
        'flex min-h-10 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64',
        className
      )}
      data-slot="combobox-item"
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <Primitive.ItemIndicator className="shrink-0" data-slot="combobox-item-indicator">
        <Check className="size-4" aria-hidden="true" />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}

export function ComboboxEmpty({ className, ...props }: Primitive.Empty.Props) {
  return (
    <Primitive.Empty
      className={cn('p-2 text-center text-sm text-muted-foreground', className)}
      data-slot="combobox-empty"
      {...props}
    />
  );
}
