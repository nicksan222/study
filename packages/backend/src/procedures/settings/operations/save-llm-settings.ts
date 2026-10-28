import { savePreferences } from '#backend/procedures/settings/preferences';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { JsonValue } from '#backend/shared/json';
import type { LlmSettings, TierSetup } from '#backend/shared/settings/types';
import { LlmModel, LlmProvider } from '#backend/shared/settings/types';

export function writeLlmSettings(ctx: BackendContext, v: LlmSettings) {
  const setup = (value: TierSetup | undefined): JsonValue => {
    if (
      !value ||
      value.provider !== LlmProvider.CHAT_GPT ||
      (value.model !== undefined &&
        !([LlmModel.GPT6_LUNA, LlmModel.GPT61_SOL, LlmModel.GPT6_ASTRA] as const).includes(
          value.model
        ))
    )
      throw new StudyError('invalid_input', 'invalid model settings');

    return value.model ?? null;
  };

  savePreferences(ctx, 'llm', {
    tiny: setup(v.tiny),
    medium: setup(v.medium),
    smart: setup(v.smart)
  });
}
