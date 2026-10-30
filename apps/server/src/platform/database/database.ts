import { Context } from 'effect';

import type { ServerContext } from './context.ts';

export class Database extends Context.Service<Database, { readonly store: ServerContext }>()(
  'study/capabilities/Database'
) {}
