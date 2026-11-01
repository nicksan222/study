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

test('import identity and representation pins remain material-owned across acquisition participants', () => {
  const diagnostics = lintRule('feature-persistence-boundary', {
    'src/features/sources/store.ts': `
      import * as schema from '@study/db/schema';
      import { sql } from '@study/db';
      import type { Db } from '@study/db'; declare const db: Db;
      const { material_imports: identities } = schema;
      const pins = schema.material_source_snapshots;
      db.select().from(identities);
      db.insert(identities);
      db.update(pins);
      sql\`DELETE FROM material_imports WHERE source_id=1\`;
    `,
    'src/features/materials/store.ts': `
      import { material_imports, material_source_snapshots } from '@study/db/schema';
      import type { Db } from '@study/db'; declare const db: Db;
      db.insert(material_imports); db.insert(material_source_snapshots);
    `
  });

  assert.deepEqual(diagnostics.map(({ message }) => message).sort(), [
    'Feature sources may not write material_imports.',
    'Feature sources may not write material_imports.',
    'Feature sources may not write material_source_snapshots.'
  ]);
});

test('canonical asset roots are derived from blocks and cannot be written by features', () => {
  const diagnostics = lintRule('feature-persistence-boundary', {
    'src/features/materials/store.ts': `
      import * as schema from '@study/db/schema';
      import type { Db } from '@study/db'; declare const db: Db;
      const { document_assets: roots } = schema;
      db.select().from(roots); db.insert(roots); db.delete(roots);
    `,
    'src/features/sources/store.ts': `
      import { sql } from '@study/db';
      import type { Db } from '@study/db'; declare const db: Db;
      sql\`UPDATE document_assets SET revision=2\`;
    `,
    'src/features/learning/store.ts': `
      import { blocks, document_assets } from '@study/db/schema';
      import type { Db } from '@study/db'; declare const db: Db;
      db.update(blocks); db.insert(document_assets);
    `
  });

  assert.deepEqual(diagnostics.map(({ message }) => message).sort(), [
    'Feature learning may not write blocks.',
    'Feature learning may not write document_assets.',
    'Feature materials may not write document_assets.',
    'Feature materials may not write document_assets.',
    'Feature sources may not write document_assets.'
  ]);
});

test('captured session context is conversation-owned while material selection pins stay material-owned', () => {
  const diagnostics = lintRule('feature-persistence-boundary', {
    'src/features/materials/store/participants.ts': `
      import * as schema from '@study/db/schema';
      import { sql } from '@study/db';
      import type { Db } from '@study/db'; declare const db: Db;
      const { session_run_contexts: captures } = schema;
      db.select().from(captures);
      db.insert(captures);
      sql\`DELETE FROM session_run_contexts WHERE session_id=1\`;
      db.insert(schema.material_source_snapshots);
    `,
    'src/features/conversations/store/capture.ts': `
      import * as schema from '@study/db/schema';
      import type { Db } from '@study/db'; declare const db: Db;
      db.insert(schema.session_run_contexts);
      db.delete(schema.session_run_contexts);
      db.select().from(schema.material_document_versions);
      db.update(schema.material_document_versions);
      db.insert(schema.session_materials);
    `
  });

  assert.deepEqual(diagnostics.map(({ message }) => message).sort(), [
    'Feature conversations may not write material_document_versions.',
    'Feature conversations may not write session_materials.',
    'Feature materials may not write session_run_contexts.',
    'Feature materials may not write session_run_contexts.'
  ]);
});

test('transform receipts and citations remain material-owned while coordinators can only read them', () => {
  const diagnostics = lintRule('feature-persistence-boundary', {
    'src/features/conversations/store/transform.ts': `
      import * as s from '@study/db/schema';
      import type { Db } from '@study/db'; declare const db: Db;
      db.select().from(s.material_generation_requests);
      db.update(s.material_generation_requests);
      db.insert(s.material_generation_inputs);
      db.delete(s.material_version_citations);
    `,
    'src/features/materials/store/generation.ts': `
      import * as s from '@study/db/schema';
      import type { Db } from '@study/db'; declare const db: Db;
      db.update(s.material_generation_requests);
      db.insert(s.material_generation_inputs);
      db.insert(s.material_version_citations);
    `
  });

  assert.deepEqual(diagnostics.map(({ message }) => message).sort(), [
    'Feature conversations may not write material_generation_inputs.',
    'Feature conversations may not write material_generation_requests.',
    'Feature conversations may not write material_version_citations.'
  ]);
});

test('edit and proposal receipts stay Material-owned and asset roots stay trigger-derived', () => {
  const diagnostics = lintRule('feature-persistence-boundary', {
    'src/features/materials/store/editing.ts': `
      import * as s from '@study/db/schema';
      import type { Db } from '@study/db'; declare const db: Db;
      db.insert(s.document_edit_receipts);
      db.insert(s.document_proposals);
      db.insert(s.document_proposal_receipts);
      db.delete(s.document_assets);
    `,
    'src/features/conversations/store/proposals.ts': `
      import * as schema from '@study/db/schema';
      import { sql } from '@study/db';
      import type { Db } from '@study/db'; declare const db: Db;
      db.select().from(schema.document_proposals);
      const { document_proposals: proposals } = schema;
      db.insert(proposals);
      db.update(schema.document_edit_receipts);
      sql\`DELETE FROM document_proposal_receipts WHERE key=\${key}\`;
    `
  });

  assert.deepEqual(diagnostics.map(({ message }) => message).sort(), [
    'Feature conversations may not write document_edit_receipts.',
    'Feature conversations may not write document_proposal_receipts.',
    'Feature conversations may not write document_proposals.',
    'Feature materials may not write document_assets.'
  ]);
});

test('historic annotations and manual judgments stay Materials-owned while message citations stay Conversations-owned', () => {
  const diagnostics = lintRule('feature-persistence-boundary', {
    'src/features/conversations/store/evidence.ts': `
      import * as s from '@study/db/schema';
      import { sql } from '@study/db';
      import type { Db } from '@study/db'; declare const db: Db;
      const { material_annotations: annotations } = s;
      db.select().from(annotations);
      db.insert(annotations);
      db.update(s['material_annotation_revisions']);
      sql\`DELETE FROM material_citation_assessments WHERE marker=1\`;
      db.insert(s.citations);
    `,
    'src/features/sources/store/correction.ts': `
      import * as s from '@study/db/schema';
      import type { Db } from '@study/db'; declare const db: Db;
      db.insert(s.material_citation_assessments);
      db.delete(s.material_annotation_revisions);
    `,
    'src/features/materials/store/evidence.ts': `
      import * as s from '@study/db/schema';
      import type { Db } from '@study/db'; declare const db: Db;
      db.insert(s.material_annotations);
      db.insert(s.material_annotation_revisions);
      db.insert(s.material_citation_assessments);
      db.select().from(s.citations);
      db.update(s.citations);
    `
  });

  assert.deepEqual(
    diagnostics.map(({ message }) => message).sort(),
    [
      'Feature conversations may not write material_annotations.',
      'Feature conversations may not write material_annotation_revisions.',
      'Feature conversations may not write material_citation_assessments.',
      'Feature sources may not write material_citation_assessments.',
      'Feature sources may not write material_annotation_revisions.',
      'Feature materials may not write citations.'
    ].sort()
  );
});
