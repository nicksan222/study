/** Raw-note citation identity points at exact external content owners. */
import type { ContentSnapshotId, PageVersionId, SourceId, VersionId } from '@study/contracts/ids';
import type { BlockId } from '@study/contracts/sources/document';

import { defineTable, sql, integer, text, primaryKey, index, check } from '../schema-builder.ts';
import type { AnySQLiteColumn } from '../schema-builder.ts';
import { content_snapshots } from './content-snapshots.ts';
import { message_versions } from './notes.ts';
import { page_versions } from './pages.ts';
import { sources } from './sources.ts';

export const citations = defineTable({ role: 'contributes', entity: 'message' })(
  'citations',
  {
    version_id: integer()
      .$type<VersionId>()
      .notNull()
      .references((): AnySQLiteColumn => message_versions.id, {
        onDelete: 'cascade'
      }),
    marker: integer().$type<bigint>().notNull(),
    source_id: integer()
      .$type<SourceId>()
      .references((): AnySQLiteColumn => sources.id, { onDelete: 'set null' }),
    authored_version_id: integer()
      .$type<PageVersionId>()
      .references((): AnySQLiteColumn => page_versions.id, { onDelete: 'set null' }),
    source_revision: integer().$type<bigint>(),
    document_id: integer()
      .$type<ContentSnapshotId>()
      .references((): AnySQLiteColumn => content_snapshots.id, { onDelete: 'set null' }),
    block_id: text().$type<BlockId>(),
    range_start: integer().$type<bigint>(),
    range_end: integer().$type<bigint>(),
    source_name: text().notNull(),
    anchor: text().notNull(),
    quote: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.version_id, t.marker] }),
    index('citations_source_idx').on(t.source_id),
    check('citations_check_1', sql`marker BETWEEN 1 AND 4294967295`),
    check('citations_check_2', sql`json_valid(anchor)`)
  ]
);
