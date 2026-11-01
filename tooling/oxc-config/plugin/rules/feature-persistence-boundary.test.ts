import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('feature writers respect table ownership while reads and shared documents remain available', () => {
  const diagnostics = lintRule('feature-persistence-boundary', {
    'src/features/projects/store.ts': `import { sessions, projects } from '@study/db/schema'; import type { Db } from '@study/db'; declare const db: Db; db.select().from(sessions); db.insert(projects); db.update(sessions); db.execute('UPDATE sessions SET title = 1');`,
    'src/features/learning/store.ts': `import type { Db } from '@study/db'; declare const db: Db; db.execute('UPDATE preferences SET value = 1');`,
    'src/features/materials/store.ts': `import { documents } from '@study/db/schema'; import type { Db } from '@study/db'; declare const db: Db; db.insert(documents);`
  });

  assert.equal(diagnostics.length, 3);
});

test('recognizes aliases and SQL without confusing unrelated APIs or reads', () => {
  const diagnostics = lintRule('feature-persistence-boundary', {
    'src/features/projects/store.ts': `
      import * as schema from '@study/db/schema';
      import { sql as query } from 'drizzle-orm';
      import type { Db } from '@study/db'; declare const db: Db;
      const ns = schema; const { sessions: s } = ns; const alias = (s as any)!;
      db.insert(alias); db.update(ns['messages']);
      query\`UPDATE \${schema.sessions} SET title = 1\`;
      query.raw('DELETE FROM preferences');
      db.execute('SELECT update, sessions FROM projects');
      logger.update(schema.sessions); parser.run('UPDATE sessions SET x=1');
      function shadow(s) { db.delete(s); }
    `,
    'src/features/sources/store.ts': `import { documents, chunks } from '@study/db/schema'; import type { Db } from '@study/db'; declare const db: Db; db.insert(documents); db.insert(chunks);`,
    'src/features/projects/store.test.ts': `import { sessions } from '@study/db/schema'; import type { Db } from '@study/db'; declare const db: Db; db.update(sessions);`
  });

  assert.equal(diagnostics.length, 4);
});

test('every exported database table has an explicit ownership policy', async () => {
  const schema = await import('../../../../packages/db/src/schema.ts');
  const { tableOwners } = await import('./feature-persistence-boundary.ts');
  const tables = Object.values(schema)
    .filter(
      (value) => typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value
    )
    .map((table) => (table as unknown as Record<symbol, string>)[Symbol.for('drizzle:Name')])
    .sort();

  assert.deepEqual(Object.keys(tableOwners).sort(), tables);
});

test('table ownership applies to contextual native factory receivers', () => {
  const diagnostics = lintRule('feature-persistence-boundary', {
    'src/features/projects/store/index.ts': `
      import { defineStore, storeMutation } from '#server/platform/definitions/define-store';
      import * as schema from '@study/db/schema';
      defineStore({make: ({db}) => ({queries: {}, mutations: {save: storeMutation({ run(input) { db.orm.update(schema.sessions).set({ title: 'bypass' }).where(predicate).run(); } })}})});
      function shadow(storeMutation) { storeMutation({ run(db) { db.orm.update(schema.sessions).run(); } }); }
    `
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('collection membership writes stay with organization and the identity-creating feature', () => {
  const diagnostics = lintRule('feature-persistence-boundary', {
    'src/features/projects/store.ts': `import { project_materials as materials, project_sessions as sessions } from '@study/db/schema'; import type { Db } from '@study/db'; declare const db: Db; db.insert(materials); db.delete(sessions);`,
    'src/features/materials/store.ts': `import * as s from '@study/db/schema'; import type { Db } from '@study/db'; declare const db: Db; db.insert(s.project_materials); db.insert(s.project_sessions);`,
    'src/features/conversations/store.ts': `import { project_sessions, project_materials as links } from '@study/db/schema'; import type { Db } from '@study/db'; declare const db: Db; db.insert(project_sessions); db.delete(links);`,
    'src/features/sources/store.ts': `import * as schema from '@study/db/schema'; import type { Db } from '@study/db'; declare const db: Db; const ns = schema; const { project_materials: links } = ns; const alias = (links as any)!; db.insert(alias); db.update(ns['project_sessions']);`,
    'src/features/learning/store.ts': `import { project_materials, project_sessions } from '@study/db/schema'; import type { Db } from '@study/db'; declare const db: Db; db.delete(project_materials); db.delete(project_sessions);`
  });

  assert.deepEqual(
    diagnostics.map(({ message }) => message).sort(),
    [
      'Feature materials may not write project_sessions.',
      'Feature conversations may not write project_materials.',
      'Feature sources may not write project_materials.',
      'Feature sources may not write project_sessions.',
      'Feature learning may not write project_materials.',
      'Feature learning may not write project_sessions.'
    ].sort()
  );
});
