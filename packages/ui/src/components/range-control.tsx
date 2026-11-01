import { IconButton } from '@study/ui/icon-button';
import { RotateCcw } from 'lucide-react';
import { useId } from 'react';
import type { CSSProperties } from 'react';

import { useRangeControl } from './use-range-control';

export function RangeControl({
  label,
  resetLabel,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  suffix = '%',
  disabled = false,
  onCommit
}: {
  label: string;
  resetLabel: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const id = useId();
  const { draft, setDraft, commit } = useRangeControl(value, disabled, onCommit);

  return (
    <div className="settings-range-control">
      <ResetButton
        visible={draft !== defaultValue}
        label={resetLabel}
        disabled={disabled}
        onReset={() => {
          setDraft(defaultValue);
          commit(defaultValue);
        }}
      />
      <output htmlFor={id}>
        {draft}
        {suffix}
      </output>
      <input
        id={id}
        className="settings-slider"
        type="range"
        aria-label={label}
        aria-valuetext={`${draft}${suffix}`}
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        style={
          {
            '--settings-slider-progress': `${((draft - min) / (max - min)) * 100}%`,
            '--settings-slider-fill-offset': `${0.5 - (draft - min) / (max - min)}rem`
          } as CSSProperties
        }
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={() => commit()}
        onKeyUp={() => commit()}
        onBlur={() => commit()}
      />
    </div>
  );
}

function ResetButton({
  visible,
  label,
  disabled,
  onReset
}: {
  visible: boolean;
  label: string;
  disabled: boolean;
  onReset: () => void;
}) {
  if (!visible) return null;

  return (
    <IconButton label={label} disabled={disabled} size="icon-micro" onClick={onReset}>
      <RotateCcw aria-hidden="true" />
    </IconButton>
  );
}
