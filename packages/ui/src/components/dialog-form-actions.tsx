import { Button } from './button';
import { DialogClose, DialogFooter } from './dialog';

/** Cancel stays before submit; both respect the same in-flight mutation boundary. */
export function DialogFormActions({
  cancelLabel,
  submitLabel,
  pending = false,
  disabled = false,
  form
}: {
  cancelLabel: string;
  submitLabel: string;
  pending?: boolean;
  disabled?: boolean;
  form?: string;
}) {
  return (
    <DialogFooter>
      <DialogClose render={<Button variant="outline" />} disabled={pending}>
        {cancelLabel}
      </DialogClose>
      <Button type="submit" form={form} disabled={pending || disabled} aria-busy={pending}>
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}

/** Uses the dialog primitive's dismissal and focus return instead of imperative closure. */
export function DialogDismissButton({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <DialogClose disabled={disabled} render={<Button type="button" variant="outline" />}>
      {label}
    </DialogClose>
  );
}
