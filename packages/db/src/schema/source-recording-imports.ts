import type { ProjectId, SessionId, SourceId } from '@study/contracts/ids';

import { defineTable, sql, blob, check, integer, text } from '../schema-builder.ts';
import { projects } from './sources.ts';

// source_id deliberately has no foreign key: a receipt survives source deletion.
export const source_recording_imports = defineTable({ role: 'contributes', entity: 'source' })(
  'source_recording_imports',
  {
    request_id: text().primaryKey().notNull(),
    project_id: integer()
      .$type<ProjectId>()
      .references(() => projects.id, { onDelete: 'set null' }),
    session_id: integer().$type<SessionId>().notNull(),
    source_id: integer().$type<SourceId>().notNull(),
    input_hash: blob({ mode: 'buffer' }).notNull(),
    duration_ms: integer().$type<bigint>().notNull()
  },
  () => [
    check('source_recording_imports_request_check', sql`length(request_id) > 0`),
    check('source_recording_imports_hash_check', sql`length(input_hash) = 32`),
    check('source_recording_imports_duration_check', sql`duration_ms >= 0`)
  ]
);
