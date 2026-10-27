import * as schema from '@study/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { JobId } from '#backend/shared/ids';

import { now, reconcileJobs as opReconcileJobs } from './worker.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: cancelJob(store, r.id)
    };
  });

export function cancelJob(ctx: BackendContext, id: JobId): boolean {
  return ctx.transaction(() => {
    const changed =
      ctx.db.orm
        .update(schema.jobs)
        .set({
          status: 'cancelled',
          waiting_for: null,
          updated_at: now(),
          finished_at: now()
        })
        .where(
          and(
            eq(schema.jobs.id, id),
            inArray(schema.jobs.status, ['blocked', 'queued', 'waiting', 'running'])
          )
        )
        .run().changes !== 0n;

    if (changed) {
      opReconcileJobs(ctx);
    }

    return changed;
  });
}
