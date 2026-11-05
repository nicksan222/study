import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from '@study/ui/button';
import { DIALOG_BACKDROP_CLASS, DIALOG_POPUP_CLASS } from '@study/ui/dialog-styles';
import { Input } from '@study/ui/input';
import { Label } from '@study/ui/label';
import { cn } from '@study/ui/utils';
import { useId, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';

export type DangerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
  confirmation: { identity: string; value: string; label: string } | null;
  pending?: boolean;
  disabled?: boolean;
  children?: ReactNode;
};

const reviewOnly = { identity: '', value: '', label: '' };

/** Null confirmation shows review content without a form or destructive action. */
export function DangerDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  confirmation,
  pending = false,
  disabled = false,
  children
}: DangerDialogProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const typed = useConfirmation(open, confirmation ?? reviewOnly);

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={cn(DIALOG_BACKDROP_CLASS, 'ui-danger-backdrop')} />
        <AlertDialog.Viewport className="ui-danger-viewport">
          <AlertDialog.Popup
            className={cn(DIALOG_POPUP_CLASS, 'ui-danger-dialog')}
            initialFocus={() => {
              cancel.current?.focus({ preventScroll: true });

              return false;
            }}
            aria-busy={pending || undefined}
          >
            <div className="ui-danger-header">
              <AlertDialog.Title className="ui-danger-title">{title}</AlertDialog.Title>
              <AlertDialog.Description className="ui-danger-description">
                {description}
              </AlertDialog.Description>
            </div>
            <div className="ui-danger-body">
              {children}
              {confirmation && (
                <div className="ui-danger-confirmation">
                  <Label htmlFor={inputId}>{confirmation.label}</Label>
                  <Input
                    id={inputId}
                    value={typed.value}
                    disabled={pending || disabled}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    onChange={(event) => typed.change(event.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="ui-danger-footer">
              <AlertDialog.Close
                disabled={pending}
                render={<Button ref={cancel} variant="outline" />}
              >
                {cancelLabel}
              </AlertDialog.Close>
              {confirmation && (
                <DangerConfirmButton
                  enabled={!pending && !disabled && typed.verified}
                  label={confirmLabel}
                  onConfirm={onConfirm}
                />
              )}
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function DangerConfirmButton({
  enabled,
  label,
  onConfirm
}: {
  enabled: boolean;
  label: string;
  onConfirm: DangerDialogProps['onConfirm'];
}) {
  return (
    <Button
      variant="destructive"
      disabled={!enabled}
      onClick={() => {
        if (enabled) void onConfirm();
      }}
    >
      {label}
    </Button>
  );
}

/** Resets typed confirmation whenever dialog visibility or target identity changes. */
function useConfirmation(
  open: boolean,
  confirmation: NonNullable<DangerDialogProps['confirmation']>
) {
  const [draft, setDraft] = useState({
    open,
    identity: confirmation.identity,
    required: confirmation.value,
    text: ''
  });
  const current =
    draft.open === open &&
    draft.identity === confirmation.identity &&
    draft.required === confirmation.value;

  if (!current) {
    setDraft({ open, identity: confirmation.identity, required: confirmation.value, text: '' });
  }

  const phrase = current ? draft.text : '';
  const verified = open && confirmation.value.length > 0 && phrase === confirmation.value;

  return {
    value: phrase,
    verified,
    change: (text: string) =>
      setDraft({
        open,
        identity: confirmation.identity,
        required: confirmation.value,
        text
      })
  };
}

export function DangerDialogContext({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('ui-danger-context', className)} {...props} />;
}

/** Presents the reviewed impact of a destructive action as aligned label-value rows. */
export function DangerDialogSummary({
  items
}: {
  items: readonly { label: string; value: ReactNode }[];
}) {
  return (
    <div className="ui-danger-summary">
      <dl>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
