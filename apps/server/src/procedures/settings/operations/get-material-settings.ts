import { loadPreferences } from '#server/procedures/settings/preferences';
import type { ServerContext } from '#server/runtime/context';

export function readMaterialSettings(ctx: ServerContext) {
  return {
    sift: loadPreferences(ctx, 'material').sift !== false
  };
}
