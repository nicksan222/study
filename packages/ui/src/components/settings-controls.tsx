import type { ComponentProps } from 'react';

import { NumberControl } from './number-control';
import { SelectControl } from './select-control';
import { SettingsRow } from './settings-group';
import { SwitchControl } from './switch-control';

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
