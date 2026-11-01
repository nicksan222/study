import { Combobox as Primitive } from '@base-ui/react/combobox';
import { cn } from '@study/ui/utils';
import { Check, Search } from 'lucide-react';
import type * as React from 'react';

import { Input } from './input';

// Single-select pieces adapted from coss/ui's MIT-licensed combobox.
export const Combobox: typeof Primitive.Root = Primitive.Root;

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
        className="z-[130] select-none outline-none"
        data-slot="combobox-positioner"
      >
        <Primitive.Popup
          className={cn(
            'study-combobox-popup max-h-[min(var(--available-height),23rem)] min-w-(--anchor-width) flex-col',
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

function ComboboxInput({
  unstyled = false,
  ...props
}: Primitive.Input.Props & { ref?: React.Ref<HTMLInputElement>; unstyled?: boolean }) {
  return (
    <Primitive.Input
      data-slot="combobox-input"
      render={<Input nativeInput unstyled={unstyled} />}
      {...props}
    />
  );
}

export function ComboboxSearchInput(props: Primitive.Input.Props) {
  return (
    <div className="study-combobox-search">
      <Search aria-hidden="true" />
      <ComboboxInput {...props} unstyled />
    </div>
  );
}

export function ComboboxList({ className, ...props }: Primitive.List.Props) {
  return (
    <Primitive.List
      className={cn(
        'max-h-[min(21rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 scroll-py-1 outline-none',
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
        "flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-base outline-none not-data-disabled:hover:bg-foreground/[0.09] data-selected:bg-foreground/[0.06] data-selected:text-foreground data-highlighted:bg-foreground/[0.09] data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
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
      className={cn('not-empty:p-2 text-center text-sm text-muted-foreground', className)}
      data-slot="combobox-empty"
      {...props}
    />
  );
}
