import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable(
  'browser entrypoints and contracts reject private value edges and contract type edges',
  async () => {
    const diagnostics = await lintRule(
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

    assert.strictEqual(diagnostics.length, 6, JSON.stringify(diagnostics));
  }
);

testStable('browser entrypoints reject private server types', async () => {
  const diagnostics = await lintRule('browser-boundary', {
    'src/client/types.ts':
      "import type { ServerContext } from '../runtime/context'; import type { AppRouter } from '../runtime/router'; import type { Secret } from '../domains/jobs/store';"
  });

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

testStable('public root rejects private server types', async () => {
  const diagnostics = await lintRule('browser-boundary', {
    'src/index.ts':
      "export type {AppRouter} from './runtime/router'; export type {ServerContext} from './runtime/context';"
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable(
  'contracts admit Effect RPC but reject workflow engine and browser clients reject router types',
  async () => {
    const diagnostics = await lintRule(
      'browser-boundary',
      {
        'packages/contracts/src/rpc.ts':
          "import { RpcGroup } from 'effect/unstable/rpc'; import { Workflow } from 'effect/unstable/workflow';",
        'apps/server/src/client/types.ts':
          "import type { AppRouter } from '../runtime/router'; import '../features/source/source.service';"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable('browser consumers cannot import server package or retired transports', async () => {
  const diagnostics = await lintRule(
    'browser-boundary',
    {
      'apps/client/src/a.ts':
        "import type { AppRouter } from '@study/server'; export * from '@trpc/client'; const load = require; load('superjson'); function f(require: any) { require('superjson'); }",
      'packages/contracts/src/a.ts': "export { x } from '@trpc/server';"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
});

testStable('browser consumers use only the explicit native client entrypoint', async () => {
  const diagnostics = await lintRule(
    'browser-boundary',
    {
      'apps/client/src/client.ts':
        "import { makeStudyClient } from '@study/server/client'; import '@study/server/client/node'; import '@study/server';"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('only the shared client host boundary can import native APIs', async () => {
  const diagnostics = await lintRule(
    'browser-boundary',
    {
      'apps/client/src/lib/host.ts':
        "import { invoke } from '@tauri-apps/api/core'; import { openUrl } from '@tauri-apps/plugin-opener';",
      'apps/client/src/pages/settings/updates.tsx':
        "import { isTauri } from '@tauri-apps/api/core';",
      'apps/client/src/lib/study-client/client.ts':
        "export { invoke } from '@tauri-apps/api/core';",
      'packages/ui/src/native.ts': "import('@tauri-apps/plugin-opener');"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/lib/host.ts')));
});
