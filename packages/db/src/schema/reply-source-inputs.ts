/** Reply captures retain exact source bytes and their completed canonical extractions. */
import type { ContentSnapshotId, PartId, SourceId } from '@study/contracts/ids';

import {
  defineTable,
  sql,
  text,
  integer,
  primaryKey,
  foreignKey,
  index,
  check
} from '../schema-builder.ts';
import { note_reply_requests } from './notes.ts';
import { source_snapshots, source_extraction_revisions } from './source-processing.ts';

export const note_reply_sources = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'note_reply_sources',
  {
    request_id: text()
      .notNull()
      .references(() => note_reply_requests.request_id, { onDelete: 'cascade' }),
    part_id: integer().$type<PartId>().notNull(),
    source_id: integer().$type<SourceId>().notNull(),
    revision: integer().$type<bigint>().notNull(),
    snapshot_id: integer().$type<ContentSnapshotId>()
  },
  (t) => [
    primaryKey({ columns: [t.request_id, t.part_id] }),
    foreignKey({
      columns: [t.source_id, t.revision],
      foreignColumns: [source_snapshots.source_id, source_snapshots.revision]
    }),
    foreignKey({
      columns: [t.source_id, t.revision, t.snapshot_id],
      foreignColumns: [
        source_extraction_revisions.source_id,
        source_extraction_revisions.revision,
        source_extraction_revisions.snapshot_id
      ]
    }),
    index('note_reply_sources_revision').on(t.source_id, t.revision),
    index('note_reply_sources_snapshot').on(t.snapshot_id),
    check('note_reply_source_identity', sql`${t.part_id}>0 AND ${t.revision}>0`)
  ]
);
