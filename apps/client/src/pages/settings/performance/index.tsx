import { PerformanceSettingsView } from './performance.view';
import { usePerformanceSettings } from './use-performance';

export function PerformanceSettings() {
  return <PerformanceSettingsView model={usePerformanceSettings()} />;
}
