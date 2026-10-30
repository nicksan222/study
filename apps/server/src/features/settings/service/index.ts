import { StudyError } from '@study/contracts/errors';
import type { JsonValue } from '@study/contracts/json';
import {
  appSettingsSchema,
  llmSettingsSchema,
  materialSettingsSchema,
  reviewSettingsSchema
} from '@study/contracts/settings/schemas';
import type {
  AppSettings,
  LlmSettings,
  MaterialSettings,
  ReviewSettings
} from '@study/contracts/settings/types';
import { Appearance, Language, LlmModel, LlmProvider } from '@study/contracts/settings/types';
import { Effect, Schema } from 'effect';

import { SettingsStore } from '#server/features/settings/store/index';
import { Database } from '#server/platform/database/database';
import { defineService } from '#server/platform/definitions/define-service';
import { transaction } from '#server/platform/definitions/define-store';

type Preferences = Record<string, JsonValue>;

const appSettings = (v: Preferences): AppSettings => ({
  language: v.language === Language.ITALIAN ? Language.ITALIAN : Language.ENGLISH,
  appearance: v.appearance === Appearance.LIGHT ? Appearance.LIGHT : Appearance.DARK,
  zoomPercent: typeof v.zoomPercent === 'number' ? v.zoomPercent : 100,
  onboarded: v.onboarded === true
});

const llmSettings = (v: Preferences): LlmSettings => {
  const setup = (key: string) => ({
    provider: LlmProvider.CHAT_GPT,
    model:
      typeof v[key] === 'number' && Object.values(LlmModel).some((model) => model === v[key])
        ? (v[key] as LlmSettings['tiny']['model'])
        : undefined
  });

  return { tiny: setup('tiny'), medium: setup('medium'), smart: setup('smart') };
};

const make = Effect.gen(function* () {
  const { store: context } = yield* Database;
  const store = SettingsStore.make(context);

  return {
    appSettings: () => store.preference('app').pipe(Effect.map(appSettings)),
    llmSettings: () => store.preference('llm').pipe(Effect.map(llmSettings)),
    materialSettings: () =>
      store.preference('material').pipe(Effect.map((v) => ({ sift: v.sift !== false }))),
    reviewSettings: () =>
      store.preference('review').pipe(
        Effect.map((v) => ({
          newCardsPerDay: typeof v.newCardsPerDay === 'number' ? v.newCardsPerDay : 20
        }))
      ),
    saveAppSettings: (input: AppSettings) =>
      !Schema.is(appSettingsSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid settings'))
        : transaction(context, (tx) => {
            tx.store(SettingsStore).saveAppSettings(input);

            return {};
          }),
    saveLlmSettings: (input: LlmSettings) =>
      !Schema.is(llmSettingsSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid settings'))
        : transaction(context, (tx) => {
            tx.store(SettingsStore).saveLlmSettings(input);

            return {};
          }),
    saveMaterialSettings: (input: MaterialSettings) =>
      !Schema.is(materialSettingsSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid settings'))
        : transaction(context, (tx) => {
            tx.store(SettingsStore).saveMaterialSettings(input);

            return {};
          }),
    saveReviewSettings: (input: ReviewSettings) =>
      !Schema.is(reviewSettingsSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid settings'))
        : transaction(context, (tx) => {
            tx.store(SettingsStore).saveReviewSettings(input);

            return {};
          }),
    language: () =>
      store
        .preference('app')
        .pipe(
          Effect.map((v) =>
            appSettings(v).language === Language.ITALIAN
              ? ('italian' as const)
              : ('english' as const)
          )
        ),
    model: (tier: 'tiny' | 'medium' | 'smart') =>
      store.preference('llm').pipe(
        Effect.map((v) => {
          const selected =
            llmSettings(v)[tier].model ??
            { tiny: LlmModel.GPT6_LUNA, medium: LlmModel.GPT61_SOL, smart: LlmModel.GPT6_ASTRA }[
              tier
            ];
          const id = {
            [LlmModel.GPT6_LUNA]: 'gpt-6-luna',
            [LlmModel.GPT61_SOL]: 'gpt-6.1-sol',
            [LlmModel.GPT6_ASTRA]: 'gpt-6-astra'
          }[selected];

          if (!id) throw new StudyError('config', 'Invalid configured model');

          return id;
        })
      )
  };
});

export const Settings = defineService('study/Settings', make);
