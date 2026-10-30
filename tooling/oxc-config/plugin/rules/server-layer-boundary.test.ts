import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('server-layer-boundary rejects forbidden edges', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/procedures/jobs/create.ts': "import { db } from '@study/db';"
  });

  assert.equal(diagnostics.length, 1);
});

test('RPC adapters delegate subscriptions instead of owning database capabilities', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/features/workflows/rpc.ts': `
      import { Database } from '#server/platform/database/database';
      import type { ServerContext } from '../../platform/database/context';
      import { Workflows } from './service';
    `,
    'src/features/workflows/service.ts': `
      import { Database } from '#server/platform/database/database';
    `
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('store network calls follow global fetch aliases without matching shadows', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/features/jobs/jobs.store.ts':
      "const request = globalThis.fetch; const run = request; run('https://example.com'); function f(fetch: () => void) { const request = fetch; request(); }"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('real SQLite tests can inspect persistence and runtime while production adapters cannot', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/procedures/projects/create/procedure.test.ts':
      "import '@study/db'; import '#server/runtime/service'; import '#server/domains/projects/store';",
    'src/procedures/projects/create/procedure.ts': "import '@study/db';"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics[0].filename.endsWith('/procedure.ts'));
});

test('feature roles enforce private stores and public cross-feature services', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/features/source/source.service.ts':
      "import '#server/features/project'; import '#server/features/project/project.service'; import './source.workflow';",
    'src/features/source/source.workflow.ts':
      "import './source.service'; import './source.store'; import '@study/db';",
    'src/features/source/source.rpc.ts':
      "import './source.service'; import './source.store'; import '@study/db';",
    'src/features/source/source.store.ts':
      "import './source.service'; const request = globalThis.fetch; request('/');",
    'src/features/source/source.service.test.ts': "import './source.store'; import '@study/db';"
  });

  assert.equal(diagnostics.length, 8, JSON.stringify(diagnostics));
});

test('feature boundaries inspect aliases and loaders without confusing shadowed require', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/features/source/source.workflow.ts':
      "const load = require; load('#server/features/source/source.store'); function f(require: (x: string) => void) { require('#server/features/source/source.store'); } import('#server/features/source/source.store');"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('feature public indexes cannot expose stores and only stores own database access', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/features/source/index.ts':
      "export { SourceService } from './source.service'; export { SourceStore } from './source.store';",
    'src/features/source/source.service.ts':
      "import { db } from '@study/db'; import type { Db } from '@study/db';",
    'src/features/source/source.decoder.ts': "import '@study/db';",
    'src/features/source/source.store.ts': "import '@study/db';"
  });

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('retired server layers and feature public exports demand migration', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/domains/a/service.ts': 'export const x = 1;',
    'src/application/define-service.ts': 'export const x = 1;',
    'src/ai/agents/a.ts': 'export const x = 1;',
    'src/procedures/a/a.ts': 'export const x = 1;',
    'src/features/a/index.ts':
      "export { helper } from './helper'; export { AService } from './a.service';",
    'src/features/a/a.rpc.ts': "import './helper'; import './a.service';",
    'src/features/a/a.workflow.ts': "import type { Db } from '@study/db';"
  });

  assert.equal(diagnostics.length, 7, JSON.stringify(diagnostics));
});

test('plain role filenames enforce the same boundaries as suffixed filenames', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/features/sources/store.ts': "import '@study/db'; import './service'; fetch('/');",
    'src/features/sources/service.ts': "import './workflow'; import '@study/db';",
    'src/features/sources/workflow.ts': "import './store'; import './service';",
    'src/features/sources/rpc.ts': "import './store'; import './service';",
    'src/features/sources/index.ts':
      "export { Sources } from './service'; export { SourceStore } from './store';"
  });

  assert.equal(diagnostics.length, 7, JSON.stringify(diagnostics));
});

test('platform capabilities are valid service dependencies but private store type exports are not', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/features/sources/service.ts':
      "import { PublicationGuard } from '#server/platform/workflows/publication';",
    'src/features/materials/service.ts':
      "export type { SourceStore as MaterialsService } from './store';",
    'src/features/sources/nested/store.ts': "import '@study/db';"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics[0].filename.endsWith('/features/materials/service.ts'));
});

test('FSRS has one platform adapter rather than feature-specific copies', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/platform/scheduling/fsrs.ts': "import { fsrs } from 'ts-fsrs';",
    'src/features/learning/srs.ts': "import { fsrs } from 'ts-fsrs';",
    'src/features/practice/store.ts': "import type { Card } from 'ts-fsrs';"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('preferences are private to settings, auth, and themes stores', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/features/settings/store.ts': "import { preferences } from '@study/db/schema';",
    'src/features/auth/token.store.ts': "import { preferences as credentials } from '@study/db';",
    'src/features/themes/store/selection.ts':
      "import * as schema from '@study/db/schema'; schema.preferences;",
    'src/features/learning/store.ts': "import { preferences as prefs } from '@study/db/schema';",
    'src/features/materials/materials.store.ts': "import { preferences } from '@study/db';",
    'src/features/conversations/store/query.ts':
      "import * as schema from '@study/db/schema'; schema.preferences; schema['preferences'];",
    'src/features/sources/store.ts':
      "import * as schema from '@study/db/schema'; const tables = schema; const { ['preferences']: prefs } = tables;",
    'src/features/settings/service.ts': "import { preferences } from '@study/db/schema';",
    'src/features/learning/store.test.ts': "import { preferences } from '@study/db/schema';"
  });

  assert.equal(diagnostics.length, 6, JSON.stringify(diagnostics));
});

test('preferences checks respect shadows, type imports, and unrelated tables', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/features/learning/store.ts':
      "import * as schema from '@study/db/schema'; import type { preferences } from '@study/db/schema'; schema.cards; const { cards } = schema; function f(schema: { preferences: string }) { const tables = schema; tables.preferences; const { preferences } = tables; }",
    'src/features/materials/store.ts':
      "import type * as schema from '@study/db/schema'; type P = typeof schema.preferences;"
  });

  assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics));
});

test('runtime assembles feature workflows only through the dispatch and recovery registry', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/runtime/workflows.ts':
      "import { sourceIngestionHandlerLayer } from '#server/features/sources/workflow';",
    'src/runtime/native.ts':
      "import { sourceIngestionHandlerLayer } from '#server/features/sources/workflow';",
    'src/runtime/workers.ts':
      "import { sourceIngestionWorkflow } from '#server/features/sources/workflow';"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});
