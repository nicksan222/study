import { savePreferences } from '#server/procedures/settings/preferences';
import type { ServerContext } from '#server/runtime/context';

export function writeMaterialSettings(ctx: ServerContext, sift: boolean) {
  savePreferences(ctx, 'material', { sift });
}
