/** @file Owns preferences within this feature. */

import type { AppSettings, JsonValue } from '@study/contracts';
import {
  voiceSettingsSchema,
  voiceSettingsPatchSchema,
  defaultVoiceSettings,
  Appearance,
  Language,
  agentRulesSchema,
  appSettingsSchema,
  appearancePreferencesSchema,
  appearancePreferencesPatchSchema,
  concurrencySettingsSchema,
  defaultAgentRules,
  defaultAppearancePreferences,
  defaultConcurrencySettings,
  defaultQuizSettings,
  defaultSidebarSettings,
  defaultWorkspacePreferences,
  materialSettingsSchema,
  quizSettingsSchema,
  reviewSettingsSchema,
  sidebarSettingsSchema,
  workspacePreferencesSchema
} from '@study/contracts';
import { useStore, validatedMutation } from '@study/server';
import { Effect, Schema } from 'effect';

import { SettingsStore } from '#server/features/settings/store/index';

export type Preferences = Record<string, JsonValue>;

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

export function* settingsPreferenceOperations() {
  const store = yield* useStore(SettingsStore);

  return {
    voiceSettings: () =>
      store.preference('voice').pipe(
        Effect.map((v) => {
          const resolved = { ...defaultVoiceSettings, ...v };

          return Schema.is(voiceSettingsSchema)(resolved) ? resolved : defaultVoiceSettings;
        })
      ),
    saveVoiceSettings: validatedMutation({
      input: voiceSettingsPatchSchema,
      message: 'Invalid voice settings',
      write: (tx, input) => {
        tx.store(SettingsStore).saveVoiceSettings(input);

        return {};
      }
    }),
    agentRules: () =>
      store.preference('agent-rules').pipe(
        Effect.map((values) => {
          const resolved = { ...defaultAgentRules, ...values };

          return Schema.is(agentRulesSchema)(resolved) ? resolved : defaultAgentRules;
        })
      ),
    saveAgentRules: validatedMutation({
      input: agentRulesSchema,
      message: 'Invalid agent rules',
      write: (tx, input) => {
        tx.store(SettingsStore).saveAgentRules(input);

        return {};
      }
    }),
    quizSettings: () =>
      store.preference('quiz').pipe(
        Effect.map((v) => {
          const resolved = { ...defaultQuizSettings, ...v };

          return Schema.is(quizSettingsSchema)(resolved) ? resolved : defaultQuizSettings;
        })
      ),
    saveQuizSettings: validatedMutation({
      input: quizSettingsSchema,
      message: 'Invalid quiz settings',
      write: (tx, input) => {
        tx.store(SettingsStore).saveQuizSettings(input);

        return {};
      }
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
    saveWorkspacePreferences: validatedMutation({
      input: workspacePreferencesSchema,
      message: 'Invalid workspace preferences',
      write: (tx, input) => {
        tx.store(SettingsStore).saveWorkspacePreferences(input);

        return {};
      }
    }),
    sidebarSettings: () =>
      store.preference('sidebar').pipe(
        Effect.map((v) => {
          const resolved = { ...defaultSidebarSettings, ...v };

          return Schema.is(sidebarSettingsSchema)(resolved) ? resolved : defaultSidebarSettings;
        })
      ),
    saveSidebarSettings: validatedMutation({
      input: sidebarSettingsSchema,
      message: 'Invalid sidebar settings',
      write: (tx, input) => {
        tx.store(SettingsStore).saveSidebarSettings(input);

        return {};
      }
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
    saveConcurrencySettings: validatedMutation({
      input: concurrencySettingsSchema,
      message: 'Invalid concurrency settings',
      write: (tx, input) => {
        tx.store(SettingsStore).saveConcurrencySettings(input);

        return {};
      }
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
    saveAppearancePreferences: validatedMutation({
      input: appearancePreferencesPatchSchema,
      message: 'Invalid appearance preferences',
      write: (tx, input) => {
        tx.store(SettingsStore).saveAppearancePreferences(input);

        return {};
      }
    }),
    appSettings: () => store.preference('app').pipe(Effect.map(appSettings)),
    materialSettings: () =>
      store.preference('material').pipe(Effect.map((v) => ({ sift: v.sift !== false }))),
    reviewSettings: () =>
      store.preference('review').pipe(
        Effect.map((v) => ({
          newCardsPerDay: typeof v.newCardsPerDay === 'number' ? v.newCardsPerDay : 20
        }))
      ),
    saveAppSettings: validatedMutation({
      input: appSettingsSchema,
      message: 'Invalid settings',
      write: (tx, input) => {
        tx.store(SettingsStore).saveAppSettings(input);

        return {};
      }
    }),
    saveMaterialSettings: validatedMutation({
      input: materialSettingsSchema,
      message: 'Invalid settings',
      write: (tx, input) => {
        tx.store(SettingsStore).saveMaterialSettings(input);

        return {};
      }
    }),
    saveReviewSettings: validatedMutation({
      input: reviewSettingsSchema,
      message: 'Invalid settings',
      write: (tx, input) => {
        tx.store(SettingsStore).saveReviewSettings(input);

        return {};
      }
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
        )
  };
}
