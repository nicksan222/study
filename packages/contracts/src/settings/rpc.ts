import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import {
  agentRulesSchema,
  quizSettingsSchema,
  workspacePreferencesSchema,
  sidebarSettingsSchema,
  appSettingsSchema,
  concurrencySettingsSchema,
  appearancePreferencesSchema,
  llmSettingsSchema,
  materialSettingsSchema,
  reviewSettingsSchema
} from './schemas.ts';
import { usageQuerySchema, usageReportSchema } from './usage.ts';

const saved = Schema.Struct({});

export const SettingsRpc = RpcGroup.make(
  Rpc.make('usage', {
    payload: usageQuerySchema,
    success: usageReportSchema,
    error: failureSchema
  }),
  Rpc.make('agentRules', { payload: {}, success: agentRulesSchema, error: failureSchema }),
  Rpc.make('saveAgentRules', { payload: agentRulesSchema, success: saved, error: failureSchema }),
  Rpc.make('quizSettings', { payload: {}, success: quizSettingsSchema, error: failureSchema }),
  Rpc.make('saveQuizSettings', {
    payload: quizSettingsSchema,
    success: saved,
    error: failureSchema
  }),
  Rpc.make('workspacePreferences', {
    payload: {},
    success: workspacePreferencesSchema,
    error: failureSchema
  }),
  Rpc.make('saveWorkspacePreferences', {
    payload: workspacePreferencesSchema,
    success: saved,
    error: failureSchema
  }),
  Rpc.make('sidebarSettings', {
    payload: {},
    success: sidebarSettingsSchema,
    error: failureSchema
  }),
  Rpc.make('saveSidebarSettings', {
    payload: sidebarSettingsSchema,
    success: saved,
    error: failureSchema
  }),
  Rpc.make('concurrencySettings', {
    payload: {},
    success: concurrencySettingsSchema,
    error: failureSchema
  }),
  Rpc.make('saveConcurrencySettings', {
    payload: concurrencySettingsSchema,
    success: saved,
    error: failureSchema
  }),
  Rpc.make('appearancePreferences', {
    payload: {},
    success: appearancePreferencesSchema,
    error: failureSchema
  }),
  Rpc.make('saveAppearancePreferences', {
    payload: appearancePreferencesSchema,
    success: saved,
    error: failureSchema
  }),
  Rpc.make('appSettings', { payload: {}, success: appSettingsSchema, error: failureSchema }),
  Rpc.make('llmSettings', { payload: {}, success: llmSettingsSchema, error: failureSchema }),
  Rpc.make('materialSettings', {
    payload: {},
    success: materialSettingsSchema,
    error: failureSchema
  }),
  Rpc.make('reviewSettings', { payload: {}, success: reviewSettingsSchema, error: failureSchema }),
  Rpc.make('saveAppSettings', { payload: appSettingsSchema, success: saved, error: failureSchema }),
  Rpc.make('saveLlmSettings', { payload: llmSettingsSchema, success: saved, error: failureSchema }),
  Rpc.make('saveMaterialSettings', {
    payload: materialSettingsSchema,
    success: saved,
    error: failureSchema
  }),
  Rpc.make('saveReviewSettings', {
    payload: reviewSettingsSchema,
    success: saved,
    error: failureSchema
  })
).prefix('settings.');
