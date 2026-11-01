import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from '@study/ui/dialog';
import { Textarea } from '@study/ui/textarea';
import { useId, useRef } from 'react';

interface DialogLabels {
  title: string;
  description: string;
  close: string;
  cancel: string;
  confirm: string;
}

export function JsonEditor({
  labels,
  value,
  error,
  pending,
  onChange,
  onFile,
  onSave,
  onClose
}: {
  labels: DialogLabels & { file: string; field: string };
  value: string;
  error?: string;
  pending: boolean;
  onChange: (value: string) => void;
  onFile: (file: File) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup closeLabel={labels.close} className="sm:max-w-2xl" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{labels.description}</p>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto px-6 pb-6">
          <input
            ref={fileRef}
            className="sr-only"
            tabIndex={-1}
            type="file"
            accept=".json,application/json"
            aria-label={labels.file}
            disabled={pending}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];

              if (file) onFile(file);

              event.currentTarget.value = '';
            }}
          />
          <Button variant="outline" disabled={pending} onClick={() => fileRef.current?.click()}>
            {labels.file}
          </Button>
          <label className="block text-sm font-medium" htmlFor={id}>
            {labels.field}
          </label>
          <Textarea
            font="mono"
            id={id}

            value={value}
            spellCheck={false}
            disabled={pending}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          {error && (
            <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button disabled={pending || !value.trim()} onClick={onSave}>
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function ConfirmDialog({
  labels,
  error,
  pending,
  onConfirm,
  onClose
}: {
  labels: DialogLabels;
  error?: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup closeLabel={labels.close} showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{labels.description}</p>
        </DialogHeader>
        {error && (
          <p role="alert" className="px-6 pb-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
