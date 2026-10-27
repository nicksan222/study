import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import { sourceKinds } from '#backend/shared/sources/sniff';

import { readerFor } from './readers/read.ts';

export const sourceKindInput = z.enum(sourceKinds);

export const run = publicProcedure
  .input(z.object({ kind: sourceKindInput, mime: z.string().default('') }))
  .query(({ input }) => {
    try {
      readerFor(input);

      return { value: true };
    } catch (error) {
      if (error instanceof StudyError && error.kind === 'unsupported') return { value: false };

      throw error;
    }
  });
