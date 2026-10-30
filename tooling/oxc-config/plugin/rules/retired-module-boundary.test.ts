import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('retired-module-boundary rejects forbidden edges', () => {
  const diagnostics = lintRule('retired-module-boundary', {
    'src/runtime/main.ts': "import type { Agent } from '@study/ai';"
  });

  assert.equal(diagnostics.length, 1);
});

test('rejects retired package imports in all module forms without matching shadowed require', () => {
  const diagnostics = lintRule(
    'retired-module-boundary',
    {
      'apps/server/src/runtime/a.ts':
        "export type { A } from '@study/ai'; import('@study/ai/x'); require('@study/ai'); function f(require: (s: string) => void) { require('@study/ai'); }",
      'packages/ai/src/agent.ts': 'export const agent = 1;',
      'apps/server/src/runtime/good.ts': "import '@study/db';"
    },
    true
  );

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('production imports cannot use retired transport or server trees', () => {
  const diagnostics = lintRule('retired-module-boundary', {
    'src/features/source/source.rpc.ts':
      "import '@trpc/server'; import('superjson'); import '#server/domains/jobs/service'; import '#server/procedures/a'; import '#server/application/a'; import '#server/ai/a'; import '#server/workflows/a';",
    'src/features/source/source.rpc.test.ts': "import '#server/domains/jobs/service';"
  });

  assert.equal(diagnostics.length, 8, JSON.stringify(diagnostics));
});

test('retired transports are rejected in test files too', () => {
  const diagnostics = lintRule('retired-module-boundary', {
    'src/features/source/source.test.ts':
      "import type { Client } from '@trpc/client'; const load = require; load('superjson'); function f(require: any) { require('superjson'); }"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('native contracts cannot depend on retired procedure contracts through package or relative edges', () => {
  const diagnostics = lintRule(
    'retired-module-boundary',
    {
      'packages/contracts/src/materials/rpc.ts':
        "import { input } from '../procedures/materials/create/input'; export type { Input } from '@study/contracts/procedures/materials/create/input'; import './schemas';"
    },
    true
  );

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('retired contracts and implementation paths are rejected even from tests', () => {
  const diagnostics = lintRule('retired-module-boundary', {
    'src/features/conversations/replay.test.ts':
      "import '@study/contracts/jobs'; import '@study/contracts/material/schemas'; import '@study/contracts/practice/schemas'; import '@study/contracts/study'; import '@study/contracts/ingestion/schemas'; import '#server/domains/jobs/index';",
    'src/domains/abandoned.test.ts': 'export const abandoned = true;'
  });

  assert.equal(diagnostics.length, 7, JSON.stringify(diagnostics));
});

test('retired runtime adapters cannot return as imports or unreferenced source files', () => {
  const diagnostics = lintRule('retired-module-boundary', {
    'src/features/a/service.ts':
      "import '#server/runtime/request'; import '#server/runtime/router'; import '#server/runtime/procedure-context';",
    'src/runtime/request.ts': 'export const runOperation = () => {};'
  });

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});
