/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds the settings RPC contract to the settings service methods.                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - RPC handlers adapt declared schemas to the owning feature service; transport wiring    │
 * │   stays here.                                                                            │
 * │ - Maps declared operations to the feature service.                                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Leaves input validation and domain behavior to contracts and service.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { SettingsRpc } from '@study/contracts/settings/rpc';
import { Effect } from 'effect';

import { Settings } from '#server/features/settings/service/index';
import { AiAdmission } from '#server/platform/ai/admission';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const SettingsRpcLive = defineRpc(
  SettingsRpc,
  { settings: Settings, admission: AiAdmission },
  ({ settings, admission }) => ({
    'settings.usage': settings.usage,
    'settings.agentRules': () => settings.agentRules(),
    'settings.saveAgentRules': settings.saveAgentRules,
    'settings.quizSettings': () => settings.quizSettings(),
    'settings.saveQuizSettings': settings.saveQuizSettings,
    'settings.workspacePreferences': () => settings.workspacePreferences(),
    'settings.saveWorkspacePreferences': settings.saveWorkspacePreferences,
    'settings.sidebarSettings': () => settings.sidebarSettings(),
    'settings.saveSidebarSettings': settings.saveSidebarSettings,
    'settings.concurrencySettings': () => settings.concurrencySettings(),
    'settings.saveConcurrencySettings': (input) =>
      settings
        .saveConcurrencySettings(input)
        .pipe(Effect.andThen(admission.configure(input)), Effect.as({}), Effect.uninterruptible),
    'settings.appearancePreferences': () => settings.appearancePreferences(),
    'settings.saveAppearancePreferences': settings.saveAppearancePreferences,
    'settings.appSettings': () => settings.appSettings(),
    'settings.llmSettings': () => settings.llmSettings(),
    'settings.materialSettings': () => settings.materialSettings(),
    'settings.reviewSettings': () => settings.reviewSettings(),
    'settings.saveAppSettings': settings.saveAppSettings,
    'settings.saveLlmSettings': settings.saveLlmSettings,
    'settings.saveMaterialSettings': settings.saveMaterialSettings,
    'settings.saveReviewSettings': settings.saveReviewSettings
  })
);
