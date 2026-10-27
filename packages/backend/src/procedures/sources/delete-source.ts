import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { originalVersion } from '#backend/procedures/ingestion/source-material';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { SourceId } from '#backend/shared/ids';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: deleteSource(store, r.id)
    };
  });

export function deleteSource(ctx: BackendContext, id: SourceId): boolean {
  return ctx.transaction(() => {
    if (originalVersion(ctx, id))
      throw new StudyError('invalid_input', 'Published source content is immutable');

    return (
      ctx.db.orm
        .delete(schema.sources)
        .where(sql`id = ${id}`)
        .run().changes !== 0n
    );
  });
}
