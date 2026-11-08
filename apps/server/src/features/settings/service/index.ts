/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Implements typed settings reads and updates, validating values before delegating   │
 * │ persistence to the settings store.                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature services own application rules and coordinate typed store operations.          │
 * │ - Validates or coordinates feature-level operations.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses owned stores and platform transactions rather than querying SQLite directly.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { JsonValue } from '@study/contracts/json';
import {
  agentRulesSchema,
  quizSettingsSchema,
  workspacePreferencesSchema,
  sidebarSettingsSchema,
  appSettingsSchema,
  concurrencySettingsSchema,
  appearancePreferencesSchema,
  llmSettingsSchema,
  tierSetupSchema,
  materialSettingsSchema,
  reviewSettingsSchema
} from '@study/contracts/settings/schemas';
import type {
  AgentRules,
  QuizSettings,
  WorkspacePreferences,
  AppSettings,
  ConcurrencySettings,
  AppearancePreferences,
  LlmSettings,
  MaterialSettings,
  ReviewSettings
} from '@study/contracts/settings/types';
import {
  defaultAgentRules,
  defaultQuizSettings,
  defaultWorkspacePreferences,
  Appearance,
  Language,
  LlmModel,
  LlmProvider,
  defaultSidebarSettings,
  defaultConcurrencySettings,
  defaultAppearancePreferences
} from '@study/contracts/settings/types';
import type { UsageQuery } from '@study/contracts/settings/usage';
import { Effect, Schema } from 'effect';

import { SettingsStore } from '#server/features/settings/store/index';
import { getApiKeyProvider } from '#server/platform/ai/providers/registry';
import { defineService } from '#server/platform/definitions/define-service';
import { transaction, useStore } from '#server/platform/definitions/define-store';
import { UsageStore } from '#server/platform/observability/usage-store';

type Preferences = Record<string, JsonValue>;

const appSettings = (v: Preferences): AppSettings => ({
  language: v.language === Language.ITALIAN ? Language.ITALIAN : Language.ENGLISH,
  appearance:
    v.appearance === Appearance.SYSTEM
      ? Appearance.SYSTEM
      : v.appearance === Appearance.LIGHT
        ? Appearance.LIGHT
        : Appearance.DARK,
  zoomPercent: typeof v.zoomPercent === 'number' ? v.zoomPercent : 100,
  onboarded: v.onboarded === true
});

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

const make = function* () {
  const store = yield* useStore(SettingsStore);
  const usage = yield* useStore(UsageStore);

  return {
    usage: (query: UsageQuery) => usage.usageReport(query),
    agentRules: () =>
      store.preference('agent-rules').pipe(
        Effect.map((values) => {
          const resolved = { ...defaultAgentRules, ...values };

          return Schema.is(agentRulesSchema)(resolved) ? resolved : defaultAgentRules;
        })
      ),
    saveAgentRules: (input: AgentRules) =>
      !Schema.is(agentRulesSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid agent rules'))
        : transaction((tx) => {
            tx.store(SettingsStore).saveAgentRules(input);

            return {};
          }),
    quizSettings: () =>
      store.preference('quiz').pipe(
        Effect.map((v) => {
          const resolved = { ...defaultQuizSettings, ...v };

          return Schema.is(quizSettingsSchema)(resolved) ? resolved : defaultQuizSettings;
        })
      ),
    saveQuizSettings: (input: QuizSettings) =>
      !Schema.is(quizSettingsSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid quiz settings'))
        : transaction((tx) => {
            tx.store(SettingsStore).saveQuizSettings(input);

            return {};
          }),
    workspacePreferences: () =>
      store.preference('workspace').pipe(
        Effect.map((v) => {
          const resolved = { ...defaultWorkspacePreferences, ...v };

          return Schema.is(workspacePreferencesSchema)(resolved)
            ? resolved
            : defaultWorkspacePreferences;
        })
      ),
    saveWorkspacePreferences: (input: WorkspacePreferences) =>
      !Schema.is(workspacePreferencesSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid workspace preferences'))
        : transaction((tx) => {
            tx.store(SettingsStore).saveWorkspacePreferences(input);

            return {};
          }),
    sidebarSettings: () =>
      store.preference('sidebar').pipe(
        Effect.map((v) => {
          const resolved = { ...defaultSidebarSettings, ...v };

          return Schema.is(sidebarSettingsSchema)(resolved) ? resolved : defaultSidebarSettings;
        })
      ),
    saveSidebarSettings: (input: typeof sidebarSettingsSchema.Type) =>
      !Schema.is(sidebarSettingsSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid sidebar settings'))
        : transaction((tx) => {
            tx.store(SettingsStore).saveSidebarSettings(input);

            return {};
          }),
    concurrencySettings: () =>
      store.preference('concurrency').pipe(
        Effect.map((v) => {
          const resolved = { ...defaultConcurrencySettings, ...v };

          return Schema.is(concurrencySettingsSchema)(resolved)
            ? resolved
            : defaultConcurrencySettings;
        })
      ),
    saveConcurrencySettings: (input: ConcurrencySettings) =>
      !Schema.is(concurrencySettingsSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid concurrency settings'))
        : transaction((tx) => {
            tx.store(SettingsStore).saveConcurrencySettings(input);

            return {};
          }),
    appearancePreferences: () =>
      store.preference('appearance').pipe(
        Effect.map((v) => {
          const resolved = { ...defaultAppearancePreferences, ...v };

          return Schema.is(appearancePreferencesSchema)(resolved)
            ? resolved
            : defaultAppearancePreferences;
        })
      ),
    saveAppearancePreferences: (input: AppearancePreferences) =>
      !Schema.is(appearancePreferencesSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid appearance preferences'))
        : transaction((tx) => {
            tx.store(SettingsStore).saveAppearancePreferences(input);

            return {};
          }),
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
        : transaction((tx) => {
            tx.store(SettingsStore).saveAppSettings(input);

            return {};
          }),
    saveLlmSettings: (input: LlmSettings) =>
      !Schema.is(llmSettingsSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid settings'))
        : transaction((tx) => {
            for (const setup of Object.values(input)) {
              if (typeof setup.provider === 'string') {
                const provider = getApiKeyProvider(setup.provider);

                if (setup.model !== undefined && !provider.models.includes(setup.model))
                  throw new StudyError('invalid_input', 'Unknown provider model');
              }
            }

            tx.store(SettingsStore).saveLlmSettings(input);

            return {};
          }),
    saveMaterialSettings: (input: MaterialSettings) =>
      !Schema.is(materialSettingsSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid settings'))
        : transaction((tx) => {
            tx.store(SettingsStore).saveMaterialSettings(input);

            return {};
          }),
    saveReviewSettings: (input: ReviewSettings) =>
      !Schema.is(reviewSettingsSchema)(input)
        ? Effect.fail(new StudyError('invalid_input', 'Invalid settings'))
        : transaction((tx) => {
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
};

export const Settings = defineService('study/Settings', make);
