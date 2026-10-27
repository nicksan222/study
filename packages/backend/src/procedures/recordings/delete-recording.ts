import * as schema from '@study/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { RecordingId } from '#backend/shared/ids';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: deleteRecording(store, r.id)
    };
  });

export function deleteRecording(ctx: BackendContext, id: RecordingId): boolean {
  return (
    ctx.db.orm.delete(schema.recordings).where(eq(schema.recordings.id, id)).run().changes !== 0n
  );
}
