import * as s from '@study/db/schema';
import { asc, eq } from 'drizzle-orm';

import { versionRow } from '#server/procedures/materials/reads';
import { anchorSchema } from '#server/procedures/materials/schemas';
import type { ServerContext } from '#server/runtime/context';

export function readCitations(store: ServerContext, id: bigint) {
  versionRow(store, id);

  return store.db.orm
    .select()
    .from(s.material_version_citations)
    .where(eq(s.material_version_citations.version_id, id))
    .orderBy(asc(s.material_version_citations.marker))
    .all()
    .map((row) => ({
      marker: row.marker,
      inputVersionId: row.input_version_id,
      anchor: anchorSchema.parse(JSON.parse(row.anchor)),
      quote: row.quote
    }));
}
