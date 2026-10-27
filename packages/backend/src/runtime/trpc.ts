import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';

import { businessFailure, backendError } from './errors.ts';
import type { ProcedureContext } from './procedure-context.ts';

const t = initTRPC.context<ProcedureContext>().create({
  transformer: superjson,
  sse: {
    ping: {
      enabled: true,
      intervalMs: 15000
    }
  },
  errorFormatter({ shape, error }) {
    const failure = businessFailure(error);

    return {
      ...shape,
      data: {
        ...shape.data,
        kind: failure.kind,
        retryAfterMs: failure.retryAfterMs
      }
    };
  }
});

export const router = t.router;

export const createCallerFactory = t.createCallerFactory;

export const publicProcedure = t.procedure.use(async ({ ctx, next, type, signal }) => {
  const result = await next();

  if (!result.ok) throw backendError(result.error, ctx.language(), signal?.aborted);

  if (type === 'mutation') ctx.refresh.publish();

  return result;
});

export const idInput = z.bigint().min(1n).max(9223372036854775807n);

export const tierSetupInput = z.object({
  provider: z.literal(1),
  model: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional()
});
