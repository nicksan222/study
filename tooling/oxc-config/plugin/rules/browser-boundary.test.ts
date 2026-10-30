import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('browser entrypoints and contracts reject private value edges and contract type edges', () => {
  const diagnostics = lintRule(
    'browser-boundary',
    {
      'packages/contracts/src/bad.ts':
        "import type { X } from '@study/db'; export type { Y } from '@study/server';",
      'packages/contracts/src/good.ts': "import type { Schema } from 'effect';",
      'apps/server/src/client/bad.ts':
        "import { db } from '@study/db'; export * from '../domains/jobs/store'; import('../ai/runtime');",
      'apps/server/src/client/good.ts':
        "import type { AppRouter } from '../runtime/router'; export type { AppRouter };",
      'apps/server/src/runtime/good.ts': "import { db } from '@study/db';"
    },
    true
  );

  assert.equal(diagnostics.length, 6, JSON.stringify(diagnostics));
});

test('browser entrypoints reject private server types', () => {
  const diagnostics = lintRule('browser-boundary', {
    'src/client/types.ts':
      "import type { ServerContext } from '../runtime/context'; import type { AppRouter } from '../runtime/router'; import type { Secret } from '../domains/jobs/store';"
  });

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('public root rejects private server types', () => {
  const diagnostics = lintRule('browser-boundary', {
    'src/index.ts':
      "export type {AppRouter} from './runtime/router'; export type {ServerContext} from './runtime/context';"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('contracts admit Effect RPC but reject workflow engine and browser clients reject router types', () => {
  const diagnostics = lintRule(
    'browser-boundary',
    {
      'packages/contracts/src/rpc.ts':
        "import { RpcGroup } from 'effect/unstable/rpc'; import { Workflow } from 'effect/unstable/workflow';",
      'apps/server/src/client/types.ts':
        "import type { AppRouter } from '../runtime/router'; import '../features/source/source.service';"
    },
    true
  );

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('browser consumers cannot import server package or retired transports', () => {
  const diagnostics = lintRule(
    'browser-boundary',
    {
      'apps/web/src/a.ts':
        "import type { AppRouter } from '@study/server'; export * from '@trpc/client'; const load = require; load('superjson'); function f(require: any) { require('superjson'); }",
      'packages/contracts/src/a.ts': "export { x } from '@trpc/server';"
    },
    true
  );

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('browser consumers use only the explicit native client entrypoint', () => {
  const diagnostics = lintRule(
    'browser-boundary',
    {
      'apps/web/src/client.ts':
        "import { makeStudyClient } from '@study/server/client'; import '@study/server/client/node'; import '@study/server';"
    },
    true
  );

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});
