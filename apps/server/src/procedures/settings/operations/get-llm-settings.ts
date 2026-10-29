import { loadPreferences } from '#server/procedures/settings/preferences';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import { LlmModel, LlmProvider } from '#server/shared/settings/types';

function isLlmModel(value: number): value is LlmModel {
  return Object.values(LlmModel).some((model) => model === value);
}

export function readLlmSettings(ctx: ServerContext) {
  const v = loadPreferences(ctx, 'llm');
  const setup = (key: string) => ({
    provider: LlmProvider.CHAT_GPT,
    model: typeof v[key] === 'number' && isLlmModel(v[key]) ? v[key] : undefined
  });

  return {
    tiny: setup('tiny'),
    medium: setup('medium'),
    smart: setup('smart')
  };
}

export function model(ctx: ServerContext, tier: 'tiny' | 'medium' | 'smart') {
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
