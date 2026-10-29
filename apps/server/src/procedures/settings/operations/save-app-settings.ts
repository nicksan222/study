import { savePreferences } from '#server/procedures/settings/preferences';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { AppSettings } from '#server/shared/settings/types';
import { Appearance, Language } from '#server/shared/settings/types';

export function writeAppSettings(ctx: ServerContext, v: AppSettings) {
  if (
    !([Language.ENGLISH, Language.ITALIAN] as const).includes(v.language) ||
    !([Appearance.LIGHT, Appearance.DARK] as const).includes(v.appearance) ||
    v.zoomPercent < 50 ||
    v.zoomPercent > 200
  )
    throw new StudyError('invalid_input', 'invalid application settings');

  savePreferences(ctx, 'app', {
    language: v.language,
    appearance: v.appearance,
    zoomPercent: v.zoomPercent,
    onboarded: v.onboarded
  });
}
