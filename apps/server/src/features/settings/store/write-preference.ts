/** @file Writes one encoded preference inside its owning store transaction. */

import { preferences } from '@study/db';
import type { StoreResources } from '@study/server';

export function writePreference(
  db: StoreResources['db'],
  scope: string,
  key: string,
  value: string
) {
  db.orm
    .insert(preferences)
    .values({ scope, key, value })
    .onConflictDoUpdate({ target: [preferences.scope, preferences.key], set: { value } })
    .run();
}
