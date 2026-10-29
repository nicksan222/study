import { listAllSessions } from '#server/procedures/conversations/operations/all-sessions';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx }) => ({ items: listAllSessions(ctx.store) }));
