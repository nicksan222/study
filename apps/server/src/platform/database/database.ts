import { Context, Effect } from 'effect';

import type { ServerContext } from './context.ts';

export class Database extends Context.Service<Database, { readonly store: ServerContext }>()(
  'study/capabilities/Database'
) {}

/** Committed refresh hints for observers; subscribers always requery persisted state. */
export const databaseChanges = Effect.map(Database, ({ store }) => ({
  subscribe: (listener: () => void) => store.subscribe(listener)
}));
