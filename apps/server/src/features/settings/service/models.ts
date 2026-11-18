/** @file Owns models within this feature. */

import type { LlmSettings, ModelTier, TierSetup } from '@study/contracts';
import {
  LlmModel,
  LlmProvider,
  StudyError,
  llmSettingsSchema,
  tierSetupSchema
} from '@study/contracts';
import { allowsAiModel, getApiKeyProvider, useStore, validatedMutation } from '@study/server';
import { Effect, Schema } from 'effect';

import { SettingsStore } from '#server/features/settings/store/index';
import { ModelUpdatesStore } from '#server/features/settings/store/model-updates';

import type { Preferences } from './preferences.ts';

const defaults = {
  tiny: LlmModel.LUNA,
  medium: LlmModel.SOL,
  smart: LlmModel.SOL
} as const;

function withoutAstra(setup: TierSetup): TierSetup {
  if (typeof setup.provider === 'string')
    return allowsAiModel(setup.model) ? setup : { provider: setup.provider };

  return setup.model === LlmModel.ASTRA ||
    !allowsAiModel(typeof setup.model === 'string' ? setup.model : undefined)
    ? { ...setup, model: LlmModel.SOL }
    : setup;
}

export const llmSettings = (v: Preferences): LlmSettings => {
  const setup = (key: string): LlmSettings['tiny'] => {
    const saved = v[key];

    if (Schema.is(tierSetupSchema)(saved)) return withoutAstra(saved);

    return withoutAstra({
      provider: LlmProvider.CHAT_GPT,
      model:
        typeof saved === 'number' && Object.values(LlmModel).some((model) => model === saved)
          ? (saved as LlmModel)
          : undefined
    });
  };

  return { tiny: setup('tiny'), medium: setup('medium'), smart: setup('smart') };
};

const chatGptIds = {
  [LlmModel.LUNA]: 'gpt-6-luna',
  [LlmModel.SOL]: 'gpt-6.1-sol',
  [LlmModel.ASTRA]: 'gpt-6.1-sol'
} as const;

export function selectedModel(
  settings: LlmSettings,
  tier: ModelTier,
  requiredProvider?: LlmProvider
) {
  const setup = settings[tier];

  if (typeof setup.provider === 'string' && requiredProvider !== LlmProvider.CHAT_GPT) {
    return { provider: setup.provider, modelId: setup.model };
  }

  const model =
    typeof setup.provider === 'string' ? defaults[tier] : (setup.model ?? defaults[tier]);

  return {
    provider: LlmProvider.CHAT_GPT,
    modelId: typeof model === 'string' ? model : chatGptIds[model]
  };
}

export function* settingsModelOperations() {
  const store = yield* useStore(SettingsStore);

  return {
    llmSettings: () => store.preference('llm').pipe(Effect.map(llmSettings)),
    saveLlmSettings: validatedMutation({
      input: llmSettingsSchema,
      message: 'Invalid settings',
      write: (tx, input) => {
        const catalog = tx.store(ModelUpdatesStore).snapshot(undefined).catalog;

        for (const setup of Object.values(input)) {
          if (typeof setup.provider === 'string') getApiKeyProvider(setup.provider);

          if (typeof setup.model !== 'string') continue;

          const choices: readonly string[] =
            typeof setup.provider === 'number' ? Object.values(chatGptIds) : [];

          if (
            !allowsAiModel(setup.model) ||
            (!choices.includes(setup.model) &&
              !catalog[String(setup.provider)]?.includes(setup.model))
          ) {
            const saved = Object.values(llmSettings(tx.store(SettingsStore).preference('llm')));

            if (
              !allowsAiModel(setup.model) ||
              !saved.some((item) => item.provider === setup.provider && item.model === setup.model)
            )
              throw new StudyError('invalid_input', 'Unknown provider model');
          }
        }

        tx.store(SettingsStore).saveLlmSettings({
          tiny: withoutAstra(input.tiny),
          medium: withoutAstra(input.medium),
          smart: withoutAstra(input.smart)
        });

        return {};
      }
    }),
    model: (tier: ModelTier, requiredProvider?: LlmProvider) =>
      store.preference('llm').pipe(
        Effect.flatMap((value) =>
          Effect.try({
            try: () => {
              const selection = selectedModel(llmSettings(value), tier, requiredProvider);

              if (!selection.modelId) throw new StudyError('config', 'Select a model in settings');

              return { ...selection, modelId: selection.modelId };
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
