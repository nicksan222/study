import type { DocumentId, SourceId } from '@study/contracts/ids';
import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core';

import { material_history_prunes } from './material-history.ts';

export const source_history_documents = sqliteTable(
  'source_history_documents',
  {
    operation_id: text()
      .notNull()
      .references(() => material_history_prunes.operation_id),
    document_id: integer().$type<DocumentId>().notNull()
  },
  (t) => [primaryKey({ columns: [t.operation_id, t.document_id] })]
);
export const source_history_revisions = sqliteTable(
  'source_history_revisions',
  {
    operation_id: text()
      .notNull()
      .references(() => material_history_prunes.operation_id),
    source_id: integer().$type<SourceId>().notNull(),
    revision: integer().$type<bigint>().notNull()
  },
  (t) => [primaryKey({ columns: [t.operation_id, t.source_id, t.revision] })]
);
