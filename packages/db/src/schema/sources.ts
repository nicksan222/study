import type { ProjectId, SourceId } from '@study/contracts/ids';
import { projectIconColors } from '@study/contracts/projects/schemas';

import { defineTable, sql, integer, text, blob, index, check } from '../schema-builder.ts';
import type { AnySQLiteColumn } from '../schema-builder.ts';
import { codes_source_kind, codes_source_origin } from './codes.ts';

export const source_blobs = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})('source_blobs', {
  source_id: integer()
    .primaryKey()
    .$type<SourceId>()
    .references((): AnySQLiteColumn => sources.id, { onDelete: 'cascade' }),
  bytes: blob({ mode: 'buffer' }).notNull()
});

export const projects = defineTable({
  role: 'entity',
  projection: 'feature',
  kind: 'project',
  description: 'Projects and their names',
  textColumns: ['name']
})(
  'projects',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<ProjectId>(),
    name: text().notNull(),
    icon: text(),
    icon_kind: text({ enum: ['monogram', 'symbol', 'emoji'] })
      .notNull()
      .default('monogram'),
    icon_color: text({ enum: projectIconColors }).notNull().default('neutral'),
    exam_on: text(),
    created_at: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull()
  },
  () => [
    check('projects_check_1', sql`length(trim(name)) > 0 AND length(name) <= 100`),
    check('projects_check_2', sql`exam_on IS NULL OR date(exam_on) IS exam_on`)
  ]
);

export const sources = defineTable({
  role: 'entity',
  projection: 'feature',
  kind: 'source',
  description: 'Imported sources and their metadata',
  textColumns: ['name']
})(
  'sources',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<SourceId>(),
    project_id: integer()
      .$type<ProjectId>()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'set null' }),
    origin: text({ enum: codes_source_origin.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_source_origin.code, {
        onDelete: 'no action'
      }),
    kind: text({ enum: codes_source_kind.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_source_kind.code, {
        onDelete: 'no action'
      }),
    mime: text().notNull(),
    name: text().notNull(),
    size_bytes: integer().$type<bigint>().notNull(),
    sha256: blob({ mode: 'buffer' }).notNull(),
    uri: text(),
    created_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    index('sources_sha256_idx').on(t.sha256),
    index('sources_project_idx').on(t.project_id),
    check('sources_check_1', sql`length(mime) > 0`),
    check('sources_check_2', sql`length(trim(name)) > 0`),
    check('sources_check_3', sql`size_bytes BETWEEN 1 AND 536870912`),
    check('sources_check_4', sql`length(sha256) = 32`),
    check('sources_check_5', sql`uri IS NULL OR length(uri) > 0`)
  ]
);
