import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import { LlmModel, LlmProvider } from '#backend/shared/settings/types';

import { loadPreferences as dbLoadPreferences } from './preferences.ts';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store } = context;

  return readLlmSettings(store);
});

export function readLlmSettings(ctx: BackendContext) {
  const v = dbLoadPreferences(ctx, 'llm');
  const setup = (key: string) => ({
    provider: LlmProvider.CHAT_GPT,
    model: typeof v[key] === 'number' ? (v[key] as LlmModel) : undefined
  });

  return {
    tiny: setup('tiny'),
    medium: setup('medium'),
    smart: setup('smart')
  };
}

export function model(ctx: BackendContext, tier: 'tiny' | 'medium' | 'smart') {
  const model =
    readLlmSettings(ctx)[tier].model ??
    {
      tiny: LlmModel.GPT6_LUNA,
      medium: LlmModel.GPT61_SOL,
      smart: LlmModel.GPT6_ASTRA
    }[tier];
  const ids: Partial<Record<LlmModel, string>> = {
    [LlmModel.GPT6_LUNA]: 'gpt-6-luna',
    [LlmModel.GPT61_SOL]: 'gpt-6.1-sol',
    [LlmModel.GPT6_ASTRA]: 'gpt-6-astra'
  };
  const id = ids[model];

  if (!id) throw new StudyError('config', 'Invalid configured model');

  return id;
}
