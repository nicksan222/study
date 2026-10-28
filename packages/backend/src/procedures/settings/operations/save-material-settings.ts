import { savePreferences } from '#backend/procedures/settings/preferences';
import type { BackendContext } from '#backend/runtime/context';

export function writeMaterialSettings(ctx: BackendContext, sift: boolean) {
  savePreferences(ctx, 'material', { sift });
}
