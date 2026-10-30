import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import {
  appSettingsSchema,
  llmSettingsSchema,
  materialSettingsSchema,
  reviewSettingsSchema
} from './schemas.ts';

const saved = Schema.Struct({});

export const SettingsRpc = RpcGroup.make(
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
