import type { ProjectId, NoteId, PageId, SourceId } from '@study/contracts/ids';
import type { integrationImportIdSchema } from '@study/contracts/integrations/schemas';

import { defineTable, text, integer, check, sql, index, primaryKey } from '../schema-builder.ts';
import { notes } from './notes.ts';
import { pages } from './pages.ts';
import { projects, sources } from './sources.ts';

/** Validated immutable transfer input and durable import progress; Workflow owns execution. */
export const integration_imports = defineTable({
  role: 'internal',
  reason: 'Staged external imports and publication progress'
})(
  'integration_imports',
  {
    id: text().primaryKey().$type<typeof integrationImportIdSchema.Type>(),
    provider_id: text().notNull(),
    source_key: text().notNull(),
    project_id: integer()
      .$type<ProjectId>()
      .references(() => projects.id, { onDelete: 'set null' }),
    state: text().notNull(),
    created_at: integer().notNull()
  },
  (t) => [
    check('integration_imports_state_json', sql`json_valid(${t.state})`),
    index('integration_imports_created_idx').on(t.created_at, t.id)
  ]
);

/** Immutable provider-normalized notes are read independently by each publication activity. */
export const integration_import_notes = defineTable({
  role: 'internal',
  reason: 'Per-note staged transfer input'
})(
  'integration_import_notes',
  {
    import_id: text()
      .notNull()
      .$type<typeof integrationImportIdSchema.Type>()
      .references(() => integration_imports.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    payload: text().notNull(),
    fingerprint: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.import_id, t.key] }),
    check('integration_import_notes_payload_json', sql`json_valid(${t.payload})`)
  ]
);

/** Original bytes are staged once; shared attachments reuse their published Source identity. */
export const integration_import_files = defineTable({
  role: 'internal',
  reason: 'Original external file snapshots and shared source receipts'
})(
  'integration_import_files',
  {
    import_id: text()
      .notNull()
      .$type<typeof integrationImportIdSchema.Type>()
      .references(() => integration_imports.id, { onDelete: 'cascade' }),
    path: text().notNull(),
    content: text().notNull(),
    source_id: integer()
      .$type<SourceId>()
      .references(() => sources.id, { onDelete: 'set null' })
  },
  (t) => [primaryKey({ columns: [t.import_id, t.path] })]
);

/** Content identities survive deletion of destinations, preventing silent resurrection. */
export const integration_receipts = defineTable({
  role: 'internal',
  reason: 'External item identity and duplicate prevention'
})('integration_receipts', {
  identity: text().primaryKey(),
  fingerprint: text().notNull(),
  import_id: text()
    .notNull()
    .$type<typeof integrationImportIdSchema.Type>()
    .references(() => integration_imports.id),
  note_id: integer()
    .$type<NoteId>()
    .references(() => notes.id, { onDelete: 'set null' }),
  page_id: integer()
    .$type<PageId>()
    .references(() => pages.id, { onDelete: 'set null' })
});
