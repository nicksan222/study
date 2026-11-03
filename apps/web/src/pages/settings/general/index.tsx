import { GeneralSettingsView } from './general.view';
import { SidebarSettings } from './sidebar-settings';
import { useGeneralSettings } from './use-general';

export function GeneralSettings() {
  return (
    <>
      <GeneralSettingsView model={useGeneralSettings()} />
      <SidebarSettings />
    </>
  );
}
