import { loadPreferences } from '#server/procedures/settings/preferences';
import type { ServerContext } from '#server/runtime/context';
import { Appearance, Language } from '#server/shared/settings/types';

export function readAppSettings(ctx: ServerContext) {
  const v = loadPreferences(ctx, 'app');

  return {
    language: v.language === Language.ITALIAN ? Language.ITALIAN : Language.ENGLISH,
    appearance: v.appearance === Appearance.LIGHT ? Appearance.LIGHT : Appearance.DARK,
    zoomPercent: typeof v.zoomPercent === 'number' ? v.zoomPercent : 100,
    onboarded: v.onboarded === true
  };
}

export function language(ctx: ServerContext) {
  return readAppSettings(ctx).language === Language.ITALIAN
    ? ('italian' as const)
    : ('english' as const);
}
