import type { DocumentId } from '@study/contracts/ids';
import { integer } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export function documentReference(reference: () => AnySQLiteColumn) {
  return integer().$type<DocumentId>().notNull().references(reference, { onDelete: 'cascade' });
}
