import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRulePaths } from '../test/utils.ts';

test('durable library identities cannot acquire collection ownership through schema aliases', () => {
  const imports =
    "import { sqliteTable as table, integer, foreignKey } from 'drizzle-orm/sqlite-core';\nimport { projects as collections } from './projects.ts';\n";
  const files = {
    'direct.ts': "table('materials', { project_id: integer().notNull() });",
    'nullable.ts': "table('sessions', { projectId: integer() });",
    'sql-name.ts': "table('material_versions', { owner: integer('project_id') });",
    'reference.ts':
      "table('materials', { owner: integer().references(() => collections.id, { onDelete: 'cascade' }) });",
    'composite.ts':
      "table('material_versions', { owner: integer() }, t => [foreignKey({ columns: [t.owner], foreignColumns: [collections.id] }).onDelete('cascade')]);",
    'aliases.ts':
      "const make = table; const name = 'sessions'; const columns = { ['project_id']: integer() }; make(name, { ...columns });",
    'builder-alias.ts':
      "const owner = integer().references(() => collections.id); table('sessions', { owner });",
    'local-projects.ts':
      "const groups = table('projects', { id: integer() }); table('materials', { owner: integer().references(() => groups.id) });",
    'typed.ts': "const columns = { project_id: integer() } as const; table('materials', columns);",
    'valid.ts':
      "table('project_materials', { project_id: integer().notNull().references(() => collections.id, { onDelete: 'cascade' }), material_id: integer().notNull() }); table('project_sessions', { project_id: integer().notNull() }); table('material_generation_requests', { project_id: integer().notNull() }); table('materials', { title: integer().notNull() }); const requests = table('material_generation_requests', { project_id: integer().notNull(), id: integer() }); table('material_versions', { request: integer().references(() => requests.id) });",
    'shadow.ts': "function define(table) { table('materials', { project_id: integer() }); }",
    'cycle.ts': "const a = b; const b = a; table('materials', a);",
    'unrelated.ts': "const object = { table }; object.table('other', { project_id: integer() });"
  };
  const prefix = 'packages/db/src/schema/';
  const diagnostics = lintRulePaths(
    'library-ownership',
    Object.fromEntries(Object.entries(files).map(([file, code]) => [prefix + file, imports + code]))
  );

  assert.deepEqual(
    diagnostics,
    Object.keys(files)
      .slice(0, 9)
      .map((file) => prefix + file)
      .sort()
  );
});
