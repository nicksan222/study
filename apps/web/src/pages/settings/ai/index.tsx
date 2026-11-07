import { AiModelSettingsView, AiAccountSettingsView } from './ai.view';
import { useAiSettings } from './use-ai-settings';

export function AiModelSettings() {
  return <AiModelSettingsView model={useAiSettings()} />;
}

/** Shares the complete sign-in lifecycle without exposing model tuning during first run. */
export function AiAccountSettings({ showHeading = true }: { showHeading?: boolean }) {
  return <AiAccountSettingsView model={useAiSettings()} showHeading={showHeading} />;
}
