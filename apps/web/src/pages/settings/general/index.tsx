import { GeneralSettingsView } from './general.view';
import { useGeneralSettings } from './use-general';

export function GeneralSettings({ showReplay = true }: { showReplay?: boolean }) {
  return <GeneralSettingsView model={useGeneralSettings()} showReplay={showReplay} />;
}
