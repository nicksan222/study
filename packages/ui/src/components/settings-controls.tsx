import { useId } from 'react';
import type { ComponentProps } from 'react';

import { NumberControl } from './number-control';
import { RangeControl } from './range-control';
import { SelectControl } from './select-control';
import { SettingsRow } from './settings-group';
import { SwitchControl } from './switch-control';
import { Textarea } from './textarea';

type RowCopy = { title: string; description?: string; controlLabel?: string };

/** Row copy supplies the default control name so visible and accessible labels stay in sync. */
export function ToggleRow({
  title,
  description,
  controlLabel = title,
  ...control
}: RowCopy & Omit<ComponentProps<typeof SwitchControl>, 'label'>) {
  return (
    <SettingsRow title={title} description={description}>
      <SwitchControl {...control} label={controlLabel} />
    </SettingsRow>
  );
}

/** Selection preferences use the same row hierarchy as switches and preserve controlled values. */
export function SelectRow({
  title,
  description,
  controlLabel = title,
  ...control
}: RowCopy & Omit<ComponentProps<typeof SelectControl>, 'label'>) {
  return (
    <SettingsRow title={title} description={description}>
      <SelectControl {...control} label={controlLabel} />
    </SettingsRow>
  );
}

/** Numeric preferences keep draft validation, save placement and row copy in one composition. */
export function NumberRow({
  title,
  description,
  controlLabel = title,
  ...control
}: RowCopy & Omit<ComponentProps<typeof NumberControl>, 'label'>) {
  return (
    <SettingsRow title={title} description={description}>
      <NumberControl {...control} label={controlLabel} />
    </SettingsRow>
  );
}

/** Range preferences keep reset, value output and keyboard commit behavior attached to row copy. */
export function RangeRow({
  title,
  description,
  controlLabel = title,
  ...control
}: RowCopy & Omit<ComponentProps<typeof RangeControl>, 'label'>) {
  return (
    <SettingsRow title={title} description={description}>
      <RangeControl {...control} label={controlLabel} />
    </SettingsRow>
  );
}

/** Long-form preferences keep a full-width editor and its help text together. */
export function TextareaRow({
  title,
  description,
  controlLabel = title,
  ...control
}: RowCopy & Omit<ComponentProps<typeof Textarea>, 'aria-label' | 'aria-describedby' | 'id'>) {
  const id = useId();

  return (
    <div className="settings-row settings-textarea-row">
      <div className="settings-row-copy">
        <label htmlFor={id}>{title}</label>
        {description && <p id={`${id}-help`}>{description}</p>}
      </div>
      <Textarea
        {...control}
        id={id}
        aria-label={controlLabel}
        aria-describedby={description ? `${id}-help` : undefined}
      />
    </div>
  );
}
