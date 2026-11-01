import { GeneralSettingsView } from './general.view';
import { useGeneralSettings } from './use-general';

export function GeneralSettings() {
  return <GeneralSettingsView model={useGeneralSettings()} />;
}
