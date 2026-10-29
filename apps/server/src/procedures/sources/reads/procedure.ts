import { readerFor } from '#server/procedures/sources/readers/read';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ input }) => {
    try {
      readerFor(input);

      return { value: true };
    } catch (error) {
      if (error instanceof StudyError && error.kind === 'unsupported') return { value: false };

      throw error;
    }
  });
