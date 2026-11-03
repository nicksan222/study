import { Switch } from '@base-ui/react/switch';

/** A labeled controlled toggle with a generous keyboard and touch target. */
export function SwitchControl({
  label,
  checked,
  onCheckedChange,
  disabled
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch.Root
      className="study-switch-control"
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
    >
      <Switch.Thumb className="study-switch-thumb" />
    </Switch.Root>
  );
}
