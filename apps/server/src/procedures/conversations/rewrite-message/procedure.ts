import { requestRewrite } from '#server/procedures/conversations/operations/rewrite-message';
import { invalid } from '#server/runtime/errors';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    if (input.how.type === 'instruction' && !input.how.instruction.trim())
      invalid('Rewrite instruction required');

    const result = requestRewrite(
      ctx.store,
      input.id,
      input.how.type,
      input.how.type === 'instruction' ? input.how.instruction : undefined
    );

    ctx.wake();

    return { type: 'queued' as const, jobId: result.jobId };
  });
