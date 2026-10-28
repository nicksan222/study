import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { originalVersion } from '#backend/procedures/ingestion/source-material';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { SourceId } from '#backend/shared/ids';

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
