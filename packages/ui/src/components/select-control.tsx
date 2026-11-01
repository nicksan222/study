import { Select } from '@base-ui/react/select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

export interface SelectControlProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export function SelectControl({
  label,
  value,
  options,
  onValueChange,
  disabled
}: SelectControlProps) {
  return (
    <Select.Root
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onValueChange(nextValue);
      }}
    >
      <Select.Trigger aria-label={label} className="study-select-trigger">
        <Select.Value className="study-select-value" />
        <Select.Icon className="study-select-icon">
          <ChevronDown aria-hidden="true" size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="study-menu-positioner"
          align="start"
          alignItemWithTrigger={false}
          sideOffset={4}
        >
          <Select.Popup className="study-select-popup">
            <Select.ScrollUpArrow className="study-select-scroll-arrow" aria-hidden="true">
              <ChevronUp size={16} />
            </Select.ScrollUpArrow>
            <Select.List className="study-select-list">
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value} className="study-select-item">
                  <Select.ItemText className="study-select-value">{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="study-select-indicator">
                    <Check size={16} aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
            <Select.ScrollDownArrow className="study-select-scroll-arrow" aria-hidden="true">
              <ChevronDown size={16} />
            </Select.ScrollDownArrow>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
