import { sql } from '@study/db';
import * as schema from '@study/db/schema';

import { originalVersion } from '#server/procedures/ingestion/source-material';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { SourceId } from '#server/shared/ids';

export function deleteSource(ctx: ServerContext, id: SourceId): boolean {
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
