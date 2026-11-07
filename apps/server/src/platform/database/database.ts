/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines the Effect Database capability around the server-owned SQLite context. Its │
 * │ observer API exposes commit hints while leaving SQLite as the source of truth.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports Database, databaseChanges. Its observer API exposes commit hints while leaving │
 * │   SQLite as the source of truth.                                                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature stores receive this capability through Effect; ServerContext owns SQLite and     │
 * │ observers must reread persisted rows.                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { dirname } from 'node:path';

import { Context, Effect } from 'effect';

import type { ServerContext } from './context.ts';

export class Database extends Context.Service<Database, { readonly store: ServerContext }>()(
  'study/capabilities/Database'
) {}

/** Committed refresh hints for observers; subscribers always requery persisted state. */
export const databaseChanges = Effect.map(Database, ({ store }) => ({
  subscribe: (listener: () => void) => store.subscribe(listener)
}));

/** Workspace assets share the owned database's parent directory. */
export const databaseDirectory = Effect.map(Database, ({ store }) => dirname(store.db.path));
