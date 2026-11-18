import { Schema } from 'effect';

import { failureSchema } from '../errors.ts';
import { allDependencies, dependency, endpointGroup, liveQuery, mutation } from '../protocol.ts';
import { modelCatalogViewSchema, modelUpdateSchema } from './model-updates.ts';
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

export const settingsEndpoints = {
  modelUpdates: liveQuery(
    'settings.modelUpdates',
    { payload: {}, success: Schema.Array(modelUpdateSchema), error: failureSchema },
    { dependencies: [dependency.settings], refresh: 'database' }
  ),
  modelCatalog: liveQuery(
    'settings.modelCatalog',
    { payload: {}, success: modelCatalogViewSchema, error: failureSchema },
    { dependencies: [dependency.settings], refresh: 'database' }
  ),
  refreshModelCatalog: mutation(
    'settings.refreshModelCatalog',
    { payload: {}, success: saved, error: failureSchema },
    { changes: [dependency.settings] }
  ),
  applyModelUpdate: mutation(
    'settings.applyModelUpdate',
    { payload: modelUpdateSchema, success: saved, error: failureSchema },
    { changes: [dependency.settings] }
  ),
  dismissModelUpdate: mutation(
    'settings.dismissModelUpdate',
    { payload: modelUpdateSchema, success: saved, error: failureSchema },
    { changes: [dependency.settings] }
  ),
  usage: liveQuery(
    'settings.usage',
    {
      payload: usageQuerySchema,
      success: usageReportSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  agentRules: liveQuery(
    'settings.agentRules',
    { payload: {}, success: agentRulesSchema, error: failureSchema },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  saveAgentRules: mutation(
    'settings.saveAgentRules',
    { payload: agentRulesSchema, success: saved, error: failureSchema },
    { changes: [dependency.settings] }
  ),
  quizSettings: liveQuery(
    'settings.quizSettings',
    { payload: {}, success: quizSettingsSchema, error: failureSchema },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  saveQuizSettings: mutation(
    'settings.saveQuizSettings',
    {
      payload: quizSettingsSchema,
      success: saved,
      error: failureSchema
    },
    { changes: [dependency.settings] }
  ),
  workspacePreferences: liveQuery(
    'settings.workspacePreferences',
    {
      payload: {},
      success: workspacePreferencesSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  saveWorkspacePreferences: mutation(
    'settings.saveWorkspacePreferences',
    {
      payload: workspacePreferencesSchema,
      success: saved,
      error: failureSchema
    },
    { changes: [dependency.settings] }
  ),
  sidebarSettings: liveQuery(
    'settings.sidebarSettings',
    {
      payload: {},
      success: sidebarSettingsSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  saveSidebarSettings: mutation(
    'settings.saveSidebarSettings',
    {
      payload: sidebarSettingsSchema,
      success: saved,
      error: failureSchema
    },
    { changes: [dependency.settings] }
  ),
  concurrencySettings: liveQuery(
    'settings.concurrencySettings',
    {
      payload: {},
      success: concurrencySettingsSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  saveConcurrencySettings: mutation(
    'settings.saveConcurrencySettings',
    {
      payload: concurrencySettingsSchema,
      success: saved,
      error: failureSchema
    },
    { changes: [dependency.settings] }
  ),
  appearancePreferences: liveQuery(
    'settings.appearancePreferences',
    {
      payload: {},
      success: appearancePreferencesSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  saveAppearancePreferences: mutation(
    'settings.saveAppearancePreferences',
    {
      payload: appearancePreferencesSchema,
      success: saved,
      error: failureSchema
    },
    { changes: [dependency.settings] }
  ),
  appSettings: liveQuery(
    'settings.appSettings',
    { payload: {}, success: appSettingsSchema, error: failureSchema },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  llmSettings: liveQuery(
    'settings.llmSettings',
    { payload: {}, success: llmSettingsSchema, error: failureSchema },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  materialSettings: liveQuery(
    'settings.materialSettings',
    {
      payload: {},
      success: materialSettingsSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  reviewSettings: liveQuery(
    'settings.reviewSettings',
    { payload: {}, success: reviewSettingsSchema, error: failureSchema },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  saveAppSettings: mutation(
    'settings.saveAppSettings',
    { payload: appSettingsSchema, success: saved, error: failureSchema },
    { changes: [dependency.settings] }
  ),
  saveLlmSettings: mutation(
    'settings.saveLlmSettings',
    { payload: llmSettingsSchema, success: saved, error: failureSchema },
    { changes: [dependency.settings] }
  ),
  saveMaterialSettings: mutation(
    'settings.saveMaterialSettings',
    {
      payload: materialSettingsSchema,
      success: saved,
      error: failureSchema
    },
    { changes: [dependency.settings] }
  ),
  saveReviewSettings: mutation(
    'settings.saveReviewSettings',
    {
      payload: reviewSettingsSchema,
      success: saved,
      error: failureSchema
    },
    { changes: [dependency.settings] }
  )
};

export const SettingsRpc = endpointGroup(settingsEndpoints);
