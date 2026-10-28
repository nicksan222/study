import { readLlmSettings } from '#backend/procedures/settings/operations/get-llm-settings';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx }) => readLlmSettings(ctx.store));
