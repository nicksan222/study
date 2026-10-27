import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { AppSettings } from '#backend/shared/settings/types';
import { Appearance, Language } from '#backend/shared/settings/types';

import { savePreferences as dbSavePreferences } from './preferences.ts';

export const run = publicProcedure
  .input(
    z.object({
      language: z.union([z.literal(1), z.literal(2)]),
      appearance: z.union([z.literal(1), z.literal(2)]),
      zoomPercent: z.number().int().min(50).max(200),
      onboarded: z.boolean()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    writeAppSettings(store, r);

    return {};
  });

export function writeAppSettings(ctx: BackendContext, v: AppSettings) {
  if (
    !([Language.ENGLISH, Language.ITALIAN] as Language[]).includes(v.language) ||
    !([Appearance.LIGHT, Appearance.DARK] as Appearance[]).includes(v.appearance) ||
    v.zoomPercent < 50 ||
    v.zoomPercent > 200
  )
    throw new StudyError('invalid_input', 'invalid application settings');

  dbSavePreferences(ctx, 'app', {
    language: v.language,
    appearance: v.appearance,
    zoomPercent: v.zoomPercent,
    onboarded: v.onboarded
  });
}
