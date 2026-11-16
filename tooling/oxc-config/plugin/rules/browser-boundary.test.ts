import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable(
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

    test.assert.strictEqual(diagnostics.length, 6, JSON.stringify(diagnostics));
  }
);

test.stable('browser entrypoints reject private server types', async () => {
  const diagnostics = await lintRule('browser-boundary', {
    'src/client/types.ts':
      "import type { ServerContext } from '../runtime/context'; import type { AppRouter } from '../runtime/router'; import type { Secret } from '../domains/jobs/store';"
  });

  test.assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test.stable('public root rejects private server types', async () => {
  const diagnostics = await lintRule('browser-boundary', {
    'src/index.ts':
      "export type {AppRouter} from './runtime/router'; export type {ServerContext} from './runtime/context';"
  });

  test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test.stable(
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

    test.assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

test.stable('browser consumers use only the explicit native client entrypoint', async () => {
  const diagnostics = await lintRule(
    'browser-boundary',
    {
      'apps/client/src/client.ts':
        "import { makeStudyClient } from '@study/server/client'; import '@study/server/client/node'; import '@study/server';"
    },
    true
  );

  test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test.stable('only the shared client host boundary can import native APIs', async () => {
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

  test.assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  test.assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/lib/host.ts')));
});
