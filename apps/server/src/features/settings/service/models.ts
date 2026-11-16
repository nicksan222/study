/** @file Owns models within this feature. */

import type { LlmSettings } from '@study/contracts';
import {
  LlmModel,
  LlmProvider,
  StudyError,
  llmSettingsSchema,
  tierSetupSchema
} from '@study/contracts';
import { getApiKeyProvider, useStore, validatedMutation } from '@study/server';
import { Effect, Schema } from 'effect';

import { SettingsStore } from '#server/features/settings/store/index';

import type { Preferences } from './preferences.ts';

const llmSettings = (v: Preferences): LlmSettings => {
  const setup = (key: string): LlmSettings['tiny'] => {
    const saved = v[key];

    if (Schema.is(tierSetupSchema)(saved)) return saved;

    return {
      provider: LlmProvider.CHAT_GPT,
      model:
        typeof saved === 'number' && Object.values(LlmModel).some((model) => model === saved)
          ? (saved as LlmModel)
          : undefined
    };
  };

  return { tiny: setup('tiny'), medium: setup('medium'), smart: setup('smart') };
};

export function* settingsModelOperations() {
  const store = yield* useStore(SettingsStore);

  return {
    llmSettings: () => store.preference('llm').pipe(Effect.map(llmSettings)),
    saveLlmSettings: validatedMutation({
      input: llmSettingsSchema,
      message: 'Invalid settings',
      write: (tx, input) => {
        for (const setup of Object.values(input)) {
          if (typeof setup.provider === 'string') {
            const provider = getApiKeyProvider(setup.provider);

            if (setup.model !== undefined && !provider.models.includes(setup.model))
              throw new StudyError('invalid_input', 'Unknown provider model');
          }
        }

        tx.store(SettingsStore).saveLlmSettings(input);

        return {};
      }
    }),
    model: (tier: 'tiny' | 'medium' | 'smart') =>
      store.preference('llm').pipe(
        Effect.flatMap((v) =>
          Effect.try({
            try: () => {
              const setup = llmSettings(v)[tier];

              if (typeof setup.provider === 'string') {
                const provider = getApiKeyProvider(setup.provider);

                if (setup.model !== undefined && !provider.models.includes(setup.model))
                  throw new StudyError('config', 'Unknown configured provider model');

                return {
                  provider: setup.provider,
                  modelId: setup.model ?? provider.defaults[tier]
                };
              }

              const selected =
                setup.model ??
                {
                  tiny: LlmModel.GPT6_LUNA,
                  medium: LlmModel.GPT61_SOL,
                  smart: LlmModel.GPT6_ASTRA
                }[tier];
              const modelId = {
                [LlmModel.GPT6_LUNA]: 'gpt-6-luna',
                [LlmModel.GPT61_SOL]: 'gpt-6.1-sol',
                [LlmModel.GPT6_ASTRA]: 'gpt-6-astra'
              }[selected];

              return { provider: setup.provider, modelId };
            },
            catch: (error) =>
              error instanceof StudyError
                ? error
                : new StudyError('config', 'Invalid configured model')
          })
        )
      )
  };
}
