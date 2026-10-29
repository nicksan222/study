import { text } from '@study/localization';

import { createUntitledSession } from '#server/procedures/conversations/operations/create-untitled-session';
import { language } from '#server/procedures/settings/operations/get-app-settings';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) =>
    createUntitledSession(
      ctx.store,
      input.project,
      input.title.trim() || text(language(ctx.store), 'NewSession')
    )
  );
