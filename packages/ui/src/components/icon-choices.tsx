import type { KeyboardEvent, ReactNode } from 'react';

export function IconChoices<T extends string>({
  label,
  options,
  value,
  onValueChange,
  disabled,
  variant = 'icons'
}: {
  label: string;
  options: readonly { value: T; label: string; content: ReactNode }[];
  value?: T;
  onValueChange: (value: T) => void;
  disabled?: boolean;
  variant?: 'icons' | 'colors';
}) {
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    );
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0 || !buttons.length) return;
    event.preventDefault();
    const previous = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + (previous ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
    buttons[next]?.click();
  }
  const hasSelection = options.some((option) => option.value === value);
  return (
    <div
      className="ui-icon-choices"
      data-variant={variant}
      role="radiogroup"
      aria-label={label}
      onKeyDown={navigate}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          className="ui-icon-choice"
          role="radio"
          aria-label={option.label}
          title={option.label}
          aria-checked={option.value === value}
          tabIndex={option.value === value || (!hasSelection && index === 0) ? 0 : -1}
          disabled={disabled}
          onClick={() => onValueChange(option.value)}
        >
          {option.content}
        </button>
      ))}
    </div>
  );
}
