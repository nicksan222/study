import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion';
import { DisclosureIcon } from '@study/icons';
import type { ComponentProps } from 'react';

import { cn } from '../utils';

// Adapted from https://ui.shadcn.com/r/styles/base-nova/accordion.json.
// MIT license: ../vendor/shadcn/LICENSE.
function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn('flex w-full min-w-0 flex-col', className)}
      {...props}
    />
  );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('min-w-0 not-last:border-b', className)}
      {...props}
    />
  );
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'group/accordion-trigger flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 rounded-md py-3 text-left text-sm font-medium outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
        <DisclosureIcon
          aria-hidden="true"
          className="ml-auto size-4 shrink-0 rotate-90 text-muted-foreground transition-transform group-aria-expanded/accordion-trigger:-rotate-90 motion-reduce:transition-none"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="h-(--accordion-panel-height) min-w-0 overflow-hidden text-sm transition-[height] duration-200 motion-reduce:transition-none data-ending-style:h-0 data-starting-style:h-0"
      {...props}
    >
      <div className={cn('grid min-w-0 gap-3 pb-4', className)}>{children}</div>
    </AccordionPrimitive.Panel>
  );
}

function AccordionTitle({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="accordion-title"
      className={cn('min-w-0 flex-1 wrap-anywhere', className)}
      {...props}
    />
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent, AccordionTitle };
