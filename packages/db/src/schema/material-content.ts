import type { MaterialVersionId } from '@study/contracts/ids';

import { defineTable, sql, integer, text, foreignKey, check } from '../schema-builder.ts';
import { material_versions } from './material-versions.ts';

export const material_diagram_versions = defineTable({ role: 'contributes', entity: 'material' })(
  'material_diagram_versions',
  {
    version_id: integer().$type<MaterialVersionId>().primaryKey(),
    kind: text({ enum: ['diagram'] })
      .notNull()
      .default('diagram'),
    format: text({ enum: ['mermaid'] }).notNull(),
    payload: text().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.version_id, t.kind],
      foreignColumns: [material_versions.id, material_versions.kind]
    }).onDelete('cascade'),
    check('payload_kind_check', sql`${t.kind}='diagram'`),
    check('material_diagram_format_check', sql`format IN ('mermaid')`),
    check('material_diagram_payload_check', sql`length(trim(payload)) > 0`)
  ]
);
