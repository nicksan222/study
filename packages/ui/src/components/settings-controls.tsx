import type { ComponentProps } from 'react';

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
