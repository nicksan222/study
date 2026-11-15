/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Initializes official execution infrastructure for owned application databases.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Registers trusted schema validation through the official SQL migrator.                 │
 * │ - Exposes initialization for offline database lifecycle tooling.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers own exclusive database access; domain migrations precede this initialization.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Db, sql } from '@study/db';

import { initializeWorkflowInfrastructure } from '#server/platform/workflows/engine';

import { runNative } from './layers.ts';

Db.configureSnapshotInfrastructure({
  initialize: (path) => runNative(initializeWorkflowInfrastructure(path)),
  migrationIdentity: (query) =>
    query.all(sql`SELECT name FROM sqlite_schema WHERE type='table' AND name='cluster_migrations'`)
      .length === 0
      ? []
      : query.all(sql`SELECT migration_id, name FROM cluster_migrations ORDER BY migration_id`)
});

/** Initialize both persistence owners before validating or publishing an offline database. */
export async function initializeDatabaseInfrastructure(db: Db): Promise<void> {
  await runNative(initializeWorkflowInfrastructure(db.path));
  await db.validateInitializedSchema();
}
