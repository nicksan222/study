import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { ErrorIcon, SuccessIcon, InfoIcon, CloseIcon } from '@study/icons';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from './button.tsx';

export const toastManager = ToastPrimitive.createToastManager();

const useToastManager = ToastPrimitive.useToastManager;

export function ToastProvider({
  children,
  closeLabel,
  viewportLabel,
  ...props
}: Omit<ComponentProps<typeof ToastPrimitive.Provider>, 'children'> & {
  children: ReactNode;
  closeLabel: string;
  viewportLabel: string;
}) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} limit={3} {...props}>
      {children}
      <Toaster closeLabel={closeLabel} viewportLabel={viewportLabel} />
    </ToastPrimitive.Provider>
  );
}

/** Renders managed notifications with accessible dismissal and optional actions. */
function Toaster({ closeLabel, viewportLabel }: { closeLabel: string; viewportLabel: string }) {
  const { toasts } = useToastManager();

  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport className="ui-toast-viewport" aria-label={viewportLabel}>
        {toasts.map((toast) => {
          const Icon =
            toast.type === 'error' ? ErrorIcon : toast.type === 'success' ? SuccessIcon : InfoIcon;

          return (
            <ToastPrimitive.Root key={toast.id} toast={toast} className="ui-toast">
              <ToastPrimitive.Content className="ui-toast-content">
                <Icon className="ui-toast-icon" aria-hidden="true" />
                <div className="ui-toast-copy">
                  <ToastPrimitive.Title className="ui-toast-title" />
                  {toast.description && (
                    <ToastPrimitive.Description className="ui-toast-description" />
                  )}
                </div>
                {toast.actionProps && (
                  <ToastPrimitive.Action
                    render={<Button className="ui-toast-action" size="sm" variant="outline" />}
                  />
                )}
                <ToastPrimitive.Close
                  aria-label={closeLabel}
                  render={<Button size="icon-sm" variant="ghost-muted" />}
                >
                  <CloseIcon aria-hidden="true" />
                </ToastPrimitive.Close>
              </ToastPrimitive.Content>
            </ToastPrimitive.Root>
          );
        })}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  );
}
