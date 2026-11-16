/** @file Owns citation rows within this feature. */

import type { citations } from '@study/db';

type CitationRow = typeof citations.$inferSelect;

export function citationInput(row: CitationRow) {
  if (row.authored_version_id !== null)
    return { kind: 'page' as const, versionId: row.authored_version_id };

  if (row.source_id !== null && row.source_revision !== null && row.document_id !== null)
    return {
      kind: 'source' as const,
      sourceId: row.source_id,
      revision: row.source_revision,
      snapshotId: row.document_id
    };

  return null;
}

export function citationPrecision(row: CitationRow) {
  return citationInput(row) !== null &&
    row.document_id !== null &&
    row.block_id !== null &&
    row.range_start !== null &&
    row.range_end !== null
    ? ('exact' as const)
    : ('approximate' as const);
}
