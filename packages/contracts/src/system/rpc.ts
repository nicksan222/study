import { Effect, Schema } from 'effect';

import { failureSchema } from '../errors.ts';
import { projectIdSchema } from '../ids.ts';
import { allDependencies, dependency, endpointGroup, liveQuery, mutation } from '../protocol.ts';
import {
  backupInputSchema,
  backupManifestSchema,
  backupBytesSchema,
  restorePreviewSchema,
  restoreStatusSchema,
  acceptRestoreSchema
} from './backups.ts';
import { searchKindSchema, searchResultSchema, materialSearchResultSchema } from './schemas.ts';

export const searchInputSchema = Schema.Struct({
  query: Schema.String,
  kinds: Schema.optional(Schema.Array(searchKindSchema)),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(30))
  ),
  project: Schema.optional(Schema.NullOr(projectIdSchema))
});

export const materialSearchInputSchema = Schema.Struct({
  query: Schema.Trim.check(Schema.isBetweenLength(1, 1000)),
  limit: searchInputSchema.fields.limit,
  project: searchInputSchema.fields.project
});

export const healthSchema = Schema.Struct({
  protocolVersion: Schema.Number,
  workersRunning: Schema.Boolean,
  testMode: Schema.Boolean
});

export const systemEndpoints = {
  createBackup: mutation(
    'system.createBackup',
    {
      payload: Schema.Struct({}),
      success: backupManifestSchema,
      error: failureSchema
    },
    { changes: 'external' }
  ),
  listBackups: liveQuery(
    'system.listBackups',
    {
      payload: Schema.Struct({}),
      success: Schema.Array(backupManifestSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  readBackup: liveQuery(
    'system.readBackup',
    {
      payload: backupInputSchema,
      success: backupBytesSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  importBackup: mutation(
    'system.importBackup',
    {
      payload: Schema.Struct({ bytes: backupBytesSchema }),
      success: backupManifestSchema,
      error: failureSchema
    },
    { changes: 'external' }
  ),
  deleteBackup: mutation(
    'system.deleteBackup',
    {
      payload: backupInputSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: 'external' }
  ),
  previewRestore: mutation(
    'system.previewRestore',
    {
      payload: backupInputSchema,
      success: restorePreviewSchema,
      error: failureSchema
    },
    { changes: 'external' }
  ),
  acceptRestore: mutation(
    'system.acceptRestore',
    {
      payload: acceptRestoreSchema,
      success: restoreStatusSchema,
      error: failureSchema
    },
    { changes: [dependency.system] }
  ),
  restoreStatus: liveQuery(
    'system.restoreStatus',
    {
      payload: Schema.Struct({}),
      success: restoreStatusSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  discardRestoreRecovery: mutation(
    'system.discardRestoreRecovery',
    {
      payload: Schema.Struct({}),
      success: Schema.Void,
      error: failureSchema
    },
    { changes: 'external' }
  ),
  health: liveQuery(
    'system.health',
    { payload: Schema.Struct({}), success: healthSchema, error: failureSchema },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  materialSearch: liveQuery(
    'system.materialSearch',
    {
      payload: materialSearchInputSchema,
      success: materialSearchResultSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  search: liveQuery(
    'system.search',
    {
      payload: searchInputSchema,
      success: searchResultSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  startWorkers: mutation(
    'system.startWorkers',
    {
      payload: Schema.Struct({}),
      success: Schema.Void,
      error: failureSchema
    },
    { changes: 'external' }
  ),
  stopWorkers: mutation(
    'system.stopWorkers',
    {
      payload: Schema.Struct({}),
      success: Schema.Void,
      error: failureSchema
    },
    { changes: 'external' }
  )
};

export const SystemRpc = endpointGroup(systemEndpoints);
