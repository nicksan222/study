import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx }) => {
    const account = ctx.auth.publicAccount();

    return {
      chatgpt: account
        ? {
            subject: account.subject,
            email: account.email,
            sharing: account.sharing
          }
        : undefined
    };
  });
