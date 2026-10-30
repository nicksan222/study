import type { DocumentId, SourceId, MaterialVersionId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text
} from 'drizzle-orm/sqlite-core';

import { codes_source_kind } from './codes.ts';
import { documents } from './documents.ts';
import { material_versions } from './material-versions.ts';
import { sources } from './sources.ts';

export const source_processing = sqliteTable(
  'source_processing',
  {
    source_id: integer()
      .primaryKey()
      .$type<SourceId>()
      .references(() => sources.id, { onDelete: 'cascade' }),
    revision: integer().$type<bigint>().notNull(),
    request_id: text().notNull(),
    published_request_id: text(),
    document_id: integer()
      .$type<DocumentId>()
      .references(() => documents.id, { onDelete: 'set null' })
  },
  (t) => [
    check('source_processing_revision_check', sql`${t.revision} > 0`),
    check('source_processing_request_check', sql`length(${t.request_id}) > 0`)
  ]
);

export const source_snapshots = sqliteTable(
  'source_snapshots',
  {
    source_id: integer()
      .$type<SourceId>()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    revision: integer().$type<bigint>().notNull(),
    bytes: blob({ mode: 'buffer' }).notNull(),
    kind: text({ enum: codes_source_kind.code.enumValues }).notNull().default('other'),
    mime: text().notNull().default('application/octet-stream'),
    uri: text()
  },
  (t) => [
    primaryKey({ columns: [t.source_id, t.revision] }),
    check('source_snapshots_revision_check', sql`${t.revision} > 0`)
  ]
);

export const material_source_snapshots = sqliteTable(
  'material_source_snapshots',
  {
    version_id: integer()
      .primaryKey()
      .$type<MaterialVersionId>()
      .references(() => material_versions.id, { onDelete: 'cascade' }),
    source_id: integer().$type<SourceId>().notNull(),
    revision: integer().$type<bigint>().notNull(),
    metadata: text().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.source_id, t.revision],
      foreignColumns: [source_snapshots.source_id, source_snapshots.revision]
    })
  ]
);
