import { Effect, Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import { projectIdSchema } from '../ids.ts';
import {
  backupInputSchema,
  backupManifestSchema,
  backupBytesSchema,
  restorePreviewSchema,
  restoreStatusSchema,
  acceptRestoreSchema
} from './backups.ts';
import { searchKindSchema, searchResultSchema } from './schemas.ts';

export const searchInputSchema = Schema.Struct({
  query: Schema.String,
  kinds: Schema.optional(Schema.Array(searchKindSchema)),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(30))
  ),
  project: Schema.optional(Schema.NullOr(projectIdSchema))
});

export const healthSchema = Schema.Struct({
  protocolVersion: Schema.Number,
  workersRunning: Schema.Boolean,
  testMode: Schema.Boolean
});

export const SystemRpc = RpcGroup.make(
  Rpc.make('createBackup', {
    payload: Schema.Struct({}),
    success: backupManifestSchema,
    error: failureSchema
  }),
  Rpc.make('listBackups', {
    payload: Schema.Struct({}),
    success: Schema.Array(backupManifestSchema),
    error: failureSchema
  }),
  Rpc.make('readBackup', {
    payload: backupInputSchema,
    success: backupBytesSchema,
    error: failureSchema
  }),
  Rpc.make('importBackup', {
    payload: Schema.Struct({ bytes: backupBytesSchema }),
    success: backupManifestSchema,
    error: failureSchema
  }),
  Rpc.make('deleteBackup', {
    payload: backupInputSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('previewRestore', {
    payload: backupInputSchema,
    success: restorePreviewSchema,
    error: failureSchema
  }),
  Rpc.make('acceptRestore', {
    payload: acceptRestoreSchema,
    success: restoreStatusSchema,
    error: failureSchema
  }),
  Rpc.make('restoreStatus', {
    payload: Schema.Struct({}),
    success: restoreStatusSchema,
    error: failureSchema
  }),
  Rpc.make('discardRestoreRecovery', {
    payload: Schema.Struct({}),
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('health', { payload: Schema.Struct({}), success: healthSchema, error: failureSchema }),
  Rpc.make('search', {
    payload: searchInputSchema,
    success: searchResultSchema,
    error: failureSchema
  }),
  Rpc.make('startWorkers', {
    payload: Schema.Struct({}),
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('stopWorkers', {
    payload: Schema.Struct({}),
    success: Schema.Void,
    error: failureSchema
  })
).prefix('system.');
