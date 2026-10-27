import { z } from 'zod';

import { releaseWaiting } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, tierSetupInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { JsonValue } from '#backend/shared/json';
import type { LlmSettings, TierSetup } from '#backend/shared/settings/types';
import { LlmModel, LlmProvider } from '#backend/shared/settings/types';

import { savePreferences as dbSavePreferences } from './preferences.ts';

export const run = publicProcedure
  .input(
    z.object({
      tiny: tierSetupInput,
      medium: tierSetupInput,
      smart: tierSetupInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;

    writeLlmSettings(store, r);
    releaseWaiting(store);
    wake();

    return {};
  });

export function writeLlmSettings(ctx: BackendContext, v: LlmSettings) {
  const setup = (v: TierSetup | undefined): JsonValue => {
    if (
      !v ||
      v.provider !== LlmProvider.CHAT_GPT ||
      (v.model !== undefined &&
        !([LlmModel.GPT6_LUNA, LlmModel.GPT61_SOL, LlmModel.GPT6_ASTRA] as LlmModel[]).includes(
          v.model
        ))
    )
      throw new StudyError('invalid_input', 'invalid model settings');

    return v.model ?? null;
  };

  dbSavePreferences(ctx, 'llm', {
    tiny: setup(v.tiny),
    medium: setup(v.medium),
    smart: setup(v.smart)
  });
}
