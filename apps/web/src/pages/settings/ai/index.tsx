import { AiSettingsView, AiAccountSettingsView } from './ai.view';
import { useAiSettings } from './use-ai-settings';

export function AiSettings() {
  return <AiSettingsView model={useAiSettings()} />;
}

/** Shares the complete sign-in lifecycle without exposing model tuning during first run. */
export function AiAccountSettings({ showHeading = true }: { showHeading?: boolean }) {
  return <AiAccountSettingsView model={useAiSettings()} showHeading={showHeading} />;
}
