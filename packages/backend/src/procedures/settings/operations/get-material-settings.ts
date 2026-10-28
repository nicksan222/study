import { loadPreferences } from '#backend/procedures/settings/preferences';
import type { BackendContext } from '#backend/runtime/context';

export function readMaterialSettings(ctx: BackendContext) {
  return {
    sift: loadPreferences(ctx, 'material').sift !== false
  };
}
