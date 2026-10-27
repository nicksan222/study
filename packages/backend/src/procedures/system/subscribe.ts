import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

/** Refresh hints follow committed writes; subscribing always starts with a full reload. */
export const run = publicProcedure.input(z.object({}).default({})).subscription(async function* ({
  ctx,
  signal
}) {
  let dirty = true;
  let wake: (() => void) | undefined;
  const notify = () => {
    dirty = true;
    wake?.();
  };
  const stop = () => wake?.();
  const unsubscribe = ctx.refresh.subscribe(notify);
  const cancellation = signal ? AbortSignal.any([signal, ctx.shutdown]) : ctx.shutdown;

  cancellation.addEventListener('abort', stop, {
    once: true
  });

  try {
    while (!cancellation.aborted) {
      if (!dirty)
        await new Promise<void>((resolve) => {
          wake = resolve;

          if (dirty || cancellation.aborted) resolve();
        });

      wake = undefined;

      if (cancellation.aborted) break;

      dirty = false;
      yield {
        type: 'refresh' as const
      };
    }
  } finally {
    unsubscribe();
    cancellation.removeEventListener('abort', stop);
  }
});
