import type { ContentSnapshotId } from '@study/contracts/ids';

import { integer } from './schema-builder.ts';
import type { AnySQLiteColumn } from './schema-builder.ts';

export function contentSnapshotReference(reference: () => AnySQLiteColumn) {
  return integer()
    .$type<ContentSnapshotId>()
    .notNull()
    .references(reference, { onDelete: 'cascade' });
}

/** A required typed identity keeps its owning table and deletion policy explicit. */
export function requiredIdReference<Id extends bigint>(reference: () => AnySQLiteColumn) {
  return integer().$type<Id>().notNull().references(reference);
}
