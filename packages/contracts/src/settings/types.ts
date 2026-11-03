/** Presentation constants and settings shared by the desktop and service. */

export const Language = {
  ENGLISH: 1,
  ITALIAN: 2
} as const;

export type Language = (typeof Language)[keyof typeof Language];

export const Rating = {
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4
} as const;

export type Rating = (typeof Rating)[keyof typeof Rating];

export const Appearance = {
  LIGHT: 1,
  DARK: 2,
  SYSTEM: 3
} as const;

export type Appearance = (typeof Appearance)[keyof typeof Appearance];

export const LlmProvider = {
  CHAT_GPT: 1
} as const;

export type LlmProvider = (typeof LlmProvider)[keyof typeof LlmProvider];

export const LlmModel = {
  GPT6_LUNA: 1,
  GPT61_SOL: 2,
  GPT6_ASTRA: 3
} as const;

export type LlmModel = (typeof LlmModel)[keyof typeof LlmModel];

import type {
  sidebarSettingsSchema,
  appSettingsSchema,
  concurrencySettingsSchema,
  appearancePreferencesSchema,
  tierSetupSchema,
  llmSettingsSchema,
  reviewSettingsSchema,
  materialSettingsSchema
} from './schemas.ts';

export type AppSettings = typeof appSettingsSchema.Type;

export type TierSetup = typeof tierSetupSchema.Type;

export type LlmSettings = typeof llmSettingsSchema.Type;

export type ReviewSettings = typeof reviewSettingsSchema.Type;

export type MaterialSettings = typeof materialSettingsSchema.Type;

export type AppearancePreferences = typeof appearancePreferencesSchema.Type;

export const defaultAppearancePreferences: AppearancePreferences = {
  contrast: 100,
  glassOpacity: 80,
  animationDurationMs: 150
};

export type ConcurrencySettings = typeof concurrencySettingsSchema.Type;

export const defaultConcurrencySettings: ConcurrencySettings = {
  maxConcurrentAi: 2,
  maxQueuedAi: 16
};

export type SidebarSettings = typeof sidebarSettingsSchema.Type;

export const defaultSidebarSettings: SidebarSettings = { settledDocumentThreshold: 1 };
