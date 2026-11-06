import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Button } from '@study/ui/button';
import {
  DIALOG_BACKDROP_CLASS,
  DIALOG_MEDIA_BACKDROP_CLASS,
  DIALOG_MEDIA_POPUP_CLASS,
  DIALOG_MOBILE_SHEET_CLASS,
  DIALOG_POPUP_CLASS
} from '@study/ui/dialog-styles';
import { cn } from '@study/ui/utils';
import { XIcon } from 'lucide-react';
import { createContext, use, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';

const ControlledOpenContext = createContext<boolean | undefined>(undefined);

function RetainedWhileClosed({ open, children }: { open: boolean; children: ReactNode }) {
  const controlledOpen = use(ControlledOpenContext);
  const isOpen = open && controlledOpen !== false;
  const [retained, setRetained] = useState(children);

  if (isOpen && retained !== children) {
    setRetained(children);
  }

  return isOpen ? children : retained;
}

function renderRetainedPopup(props: ComponentProps<'div'>, state: { open: boolean }) {
  return (
    <div {...props}>
      <RetainedWhileClosed open={state.open}>{props.children}</RetainedWhileClosed>
    </div>
  );
}

function Dialog<Payload>(props: DialogPrimitive.Root.Props<Payload>) {
  return (
    <ControlledOpenContext value={props.open}>
      <DialogPrimitive.Root {...props} />
    </ControlledOpenContext>
  );
}

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogTrigger = DialogPrimitive.Trigger;

function DialogBackdrop({
  className,
  variant = 'default',
  ...props
}: DialogPrimitive.Backdrop.Props & { variant?: 'default' | 'media' }) {
  return (
    <DialogPrimitive.Backdrop
      forceRender
      className={cn(
        variant === 'media' ? DIALOG_MEDIA_BACKDROP_CLASS : DIALOG_BACKDROP_CLASS,
        className
      )}
      data-slot="dialog-backdrop"
      {...props}
    />
  );
}

function DialogViewport({ className, ...props }: DialogPrimitive.Viewport.Props) {
  return (
    <DialogPrimitive.Viewport
      className={cn(
        'fixed inset-0 z-50 grid grid-rows-[1fr_auto_1fr] justify-items-center p-4',
        className
      )}
      data-slot="dialog-viewport"
      {...props}
    />
  );
}

const popupClasses = {
  default: '',
  media: '',
  identity: 'ui-identity-dialog',
  'workspace-context': 'session-context-dialog',
  'practice-generation': 'study-generation-dialog'
} as const;

/** Composes the portal surface with the chosen size, backdrop and dismissal control. */
function DialogPopup({
  className,
  viewportClassName,
  children,
  showCloseButton = true,
  keepMounted = false,
  closeLabel,
  bottomStickOnMobile = true,
  variant = 'default',
  ...props
}: DialogPrimitive.Popup.Props & {
  viewportClassName?: string;
  showCloseButton?: boolean;
  keepMounted?: boolean;
  closeLabel: string;
  bottomStickOnMobile?: boolean;
  variant?: 'default' | 'media' | 'identity' | 'workspace-context' | 'practice-generation';
}) {
  return (
    <DialogPortal keepMounted={keepMounted}>
      {/* Media opens from inside other overlays (a composer chip, a popover), so it sits above them. */}
      <DialogBackdrop
        className={variant === 'media' ? 'z-[60]' : undefined}
        variant={variant === 'media' ? 'media' : 'default'}
      />
      <DialogViewport
        className={cn(
          bottomStickOnMobile && 'max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12',
          variant === 'media' &&
            'z-[60] grid-rows-1 place-items-center px-4 pb-6 pt-[calc(var(--native-titlebar-height,0px)+1.5rem)] [-webkit-app-region:no-drag]',
          viewportClassName
        )}
      >
        <DialogPrimitive.Popup
          className={cn(
            variant === 'media' ? DIALOG_MEDIA_POPUP_CLASS : DIALOG_POPUP_CLASS,
            'row-start-2 text-popover-foreground',
            variant !== 'media' && 'max-h-full max-w-lg',
            popupClasses[variant],
            bottomStickOnMobile && DIALOG_MOBILE_SHEET_CLASS,
            className
          )}
          data-slot="dialog-popup"
          render={renderRetainedPopup}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label={closeLabel}
              className="absolute end-2 top-2"
              render={<Button size="icon" variant="ghost" />}
            >
              <XIcon />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pb-3 max-sm:pb-4',
        className
      )}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'bare';
}) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end sm:rounded-b-[calc(var(--radius-2xl)-1px)]',
        variant === 'default' && 'border-t bg-muted/72 py-4',
        variant === 'bare' && 'py-4',
        className
      )}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn('wrap-anywhere font-semibold text-xl leading-none', className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm leading-relaxed text-muted-foreground', className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

export {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogTrigger
};
