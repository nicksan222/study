import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import { Appearance, Language } from '#backend/shared/settings/types';

import { loadPreferences as dbLoadPreferences } from './preferences.ts';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store } = context;

  return readAppSettings(store);
});

export function readAppSettings(ctx: BackendContext) {
  const v = dbLoadPreferences(ctx, 'app');

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
