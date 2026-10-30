import type { MaterialVersionId } from '@study/contracts/ids';
import { asc, eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { makeReads } from '#server/features/materials/store/reads';
import { anchorSchema } from '#server/features/materials/store/schemas';
import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeCitations(resources: StoreResources) {
  const { db } = resources;
  const store = db;
  const { versionRow } = makeReads(resources);

  function readCitations(id: MaterialVersionId) {
    versionRow(id);

    return store.orm
      .select()
      .from(s.material_version_citations)
      .where(eq(s.material_version_citations.version_id, id))
      .orderBy(asc(s.material_version_citations.marker))
      .all()
      .map((row) => ({
        marker: row.marker,
        inputVersionId: row.input_version_id,
        anchor: Schema.decodeUnknownSync(anchorSchema)(JSON.parse(row.anchor)),
        quote: row.quote
      }));
  }

  return {
    readCitations
  };
}
