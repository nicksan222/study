import { AiSettingsView } from './ai.view';
import { useAiSettings } from './use-ai-settings';

export function AiSettings() {
  return <AiSettingsView model={useAiSettings()} />;
}
