import { loadPreferences } from '#backend/procedures/settings/preferences';
import type { BackendContext } from '#backend/runtime/context';
import { Appearance, Language } from '#backend/shared/settings/types';

export function readAppSettings(ctx: BackendContext) {
  const v = loadPreferences(ctx, 'app');

  return {
    language: v.language === Language.ITALIAN ? Language.ITALIAN : Language.ENGLISH,
    appearance: v.appearance === Appearance.LIGHT ? Appearance.LIGHT : Appearance.DARK,
    zoomPercent: typeof v.zoomPercent === 'number' ? v.zoomPercent : 100,
    onboarded: v.onboarded === true
  };
}

export function language(ctx: BackendContext) {
  return readAppSettings(ctx).language === Language.ITALIAN
    ? ('italian' as const)
    : ('english' as const);
}
