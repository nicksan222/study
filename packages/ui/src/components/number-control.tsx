import { Button } from '@study/ui/button';
import { Input } from '@study/ui/input';
import { useId } from 'react';

export function NumberControl({
  label,
  value,
  min,
  max,
  onValueChange,
  onSubmit,
  submitLabel,
  disabled,
  submitDisabled,
  error
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled?: boolean;
  submitDisabled?: boolean;
  error?: string;
}) {
  const errorId = useId();

  return (
    <form
      className="flex flex-wrap items-center justify-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();

        if (!disabled && !submitDisabled) onSubmit();
      }}
    >
      <Input
        type="number"
        nativeInput
        className="w-24"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <Button type="submit" variant="outline" size="sm" disabled={disabled || submitDisabled}>
        {submitLabel}
      </Button>
      {error && (
        <p id={errorId} role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
