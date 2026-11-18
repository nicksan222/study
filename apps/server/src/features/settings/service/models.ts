/** @file Owns models within this feature. */

import type { LlmSettings, ModelTier, TierSetup } from '@study/contracts';
import {
  chatGptModelIds,
  LlmModel,
  LlmProvider,
  StudyError,
  llmSettingsSchema,
  modelTiers,
  saveModelTierSchema,
  tierSetupSchema
} from '@study/contracts';
import { allowsAiModel, getApiKeyProvider, useStore, validatedMutation } from '@study/server';
import { Effect, Schema } from 'effect';

import { SettingsStore } from '#server/features/settings/store/index';
import { accountCatalog, ModelUpdatesStore } from '#server/features/settings/store/model-updates';

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
    modelId: typeof model === 'string' ? model : chatGptModelIds[model]
  };
}

function validateChoice(
  setup: TierSetup,
  saved: TierSetup,
  catalog: Readonly<Record<string, readonly string[]>>
) {
  if (typeof setup.provider === 'string') getApiKeyProvider(setup.provider);

  if (setup.model === undefined) return;

  const id = typeof setup.model === 'number' ? chatGptModelIds[setup.model] : setup.model;
  const available =
    catalog[String(setup.provider)] ??
    (setup.provider === LlmProvider.CHAT_GPT ? Object.values(chatGptModelIds) : []);
  const unchanged = saved.provider === setup.provider && saved.model === setup.model;

  if (!allowsAiModel(id) || (!unchanged && !available.includes(id)))
    throw new StudyError('invalid_input', 'Unknown provider model');
}

export function* settingsModelOperations(account: () => string | null | undefined) {
  const store = yield* useStore(SettingsStore);

  return {
    llmSettings: () => store.preference('llm').pipe(Effect.map(llmSettings)),
    saveLlmSettings: validatedMutation({
      input: llmSettingsSchema,
      message: 'Invalid settings',
      write: (tx, input) => {
        const catalog = accountCatalog(
          tx.store(ModelUpdatesStore).snapshot(undefined),
          account()
        ).catalog;
        const saved = llmSettings(tx.store(SettingsStore).preference('llm'));

        for (const tier of modelTiers) validateChoice(input[tier], saved[tier], catalog);

        tx.store(SettingsStore).saveLlmSettings({
          tiny: withoutAstra(input.tiny),
          medium: withoutAstra(input.medium),
          smart: withoutAstra(input.smart)
        });

        return {};
      }
    }),
    saveModelTier: validatedMutation({
      input: saveModelTierSchema,
      message: 'Invalid model selection',
      write: (tx, { tier, setup }) => {
        const store = tx.store(SettingsStore);
        const saved = llmSettings(store.preference('llm'));
        const catalog = accountCatalog(
          tx.store(ModelUpdatesStore).snapshot(undefined),
          account()
        ).catalog;

        validateChoice(setup, saved[tier], catalog);
        store.saveLlmSettings({ ...saved, [tier]: withoutAstra(setup) });

        return {};
      }
    }),
    model: (tier: ModelTier, requiredProvider?: LlmProvider) =>
      store.preference('llm').pipe(
        Effect.flatMap((value) =>
          Effect.try({
            try: () => {
              const selection = selectedModel(llmSettings(value), tier, requiredProvider);

              if (typeof selection.provider === 'string') getApiKeyProvider(selection.provider);

              if (!selection.modelId) throw new StudyError('config', 'Select a model in settings');

              return { ...selection, modelId: selection.modelId };
            },
            catch: (error) =>
              error instanceof StudyError && error.kind !== 'invalid_input'
                ? error
                : new StudyError('config', 'Invalid configured model', { cause: error })
          })
        )
      )
  };
}
