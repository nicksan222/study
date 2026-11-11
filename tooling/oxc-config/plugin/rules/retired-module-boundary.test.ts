import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('retired-module-boundary rejects forbidden edges', async () => {
  const diagnostics = await lintRule('retired-module-boundary', {
    'src/runtime/main.ts': "import type { Agent } from '@study/ai';"
  });

  assert.strictEqual(diagnostics.length, 1);
});

testStable(
  'rejects retired package imports in all module forms without matching shadowed require',
  async () => {
    const diagnostics = await lintRule(
      'retired-module-boundary',
      {
        'apps/server/src/runtime/a.ts':
          "export type { A } from '@study/ai'; import('@study/ai/x'); require('@study/ai'); function f(require: (s: string) => void) { require('@study/ai'); }",
        'packages/ai/src/agent.ts': 'export const agent = 1;',
        'apps/server/src/runtime/good.ts': "import '@study/db';"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

testStable('production imports cannot use retired transport or server trees', async () => {
  const diagnostics = await lintRule('retired-module-boundary', {
    'src/features/source/source.rpc.ts':
      "import '@trpc/server'; import('superjson'); import '#server/domains/jobs/service'; import '#server/procedures/a'; import '#server/application/a'; import '#server/ai/a'; import '#server/workflows/a';",
    'src/features/source/source.rpc.test.ts': "import '#server/domains/jobs/service';"
  });

  assert.strictEqual(diagnostics.length, 8, JSON.stringify(diagnostics));
});

testStable('retired transports are rejected in test files too', async () => {
  const diagnostics = await lintRule('retired-module-boundary', {
    'src/features/source/source.test.ts':
      "import type { Client } from '@trpc/client'; const load = require; load('superjson'); function f(require: any) { require('superjson'); }"
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable(
  'native contracts cannot depend on retired procedure contracts through package or relative edges',
  async () => {
    const diagnostics = await lintRule(
      'retired-module-boundary',
      {
        'packages/contracts/src/materials/rpc.ts':
          "import { input } from '../procedures/materials/create/input'; export type { Input } from '@study/contracts/procedures/materials/create/input'; import './schemas';"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable('retired contracts and implementation paths are rejected even from tests', async () => {
  const diagnostics = await lintRule('retired-module-boundary', {
    'src/features/notes/replay.test.ts':
      "import '@study/contracts/jobs'; import '@study/contracts/material/schemas'; import '@study/contracts/practice/schemas'; import '@study/contracts/study'; import '@study/contracts/ingestion/schemas'; import '#server/domains/jobs/index';",
    'src/domains/abandoned.test.ts': 'export const abandoned = true;'
  });

  assert.strictEqual(diagnostics.length, 7, JSON.stringify(diagnostics));
});

testStable(
  'retired runtime adapters cannot return as imports or unreferenced source files',
  async () => {
    const diagnostics = await lintRule('retired-module-boundary', {
      'src/features/a/service.ts':
        "import '#server/runtime/request'; import '#server/runtime/router'; import '#server/runtime/procedure-context';",
      'src/runtime/request.ts': 'export const runOperation = () => {};'
    });

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

testStable(
  'rejects retired Notes and Pages import paths across packages and relative edges',
  async () => {
    const diagnostics = await lintRule('retired-module-boundary', {
      'src/features/notes/example.ts': `
      import '@study/contracts/conversations/schemas';
      export * from '@study/contracts/documents';
      import('#server/features/documents/index');
      require('#server/features/conversations/index');
    `,
      'src/features/pages/example.ts': `import '../../../web/src/features/authored-documents';`
    });
    const web = await lintRule(
      'retired-module-boundary',
      {
        'apps/web/src/app/example.ts': `
      import '../features/authored-documents';
      import '../features/session-workspace';
      import '@study/ui/session-workspace';
    `,
        'packages/contracts/src/notes/example.ts': `export * from '../documents/schemas';`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
    assert.strictEqual(web.length, 4, JSON.stringify(web));
  }
);

testStable('rejects retired domain files even without importers', async () => {
  const diagnostics = await lintRule(
    'retired-module-boundary',
    {
      'apps/server/src/features/conversations/orphan.ts': 'export const orphan = true;',
      'apps/web/src/features/authored-documents/orphan.ts': 'export const orphan = true;',
      'packages/contracts/src/documents/orphan.ts': 'export const orphan = true;'
    },
    true
  );

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

testStable(
  'keeps canonical source content, document presentation and OAuth session modules',
  async () => {
    const diagnostics = await lintRule(
      'retired-module-boundary',
      {
        'apps/server/src/features/notes/example.ts': `
      import '@study/contracts/sources/document';
      import '#server/platform/ai/providers/chatgpt/session';
      import '@study/contracts/pages/types';
    `,
        'apps/web/src/features/pages/example.ts': `import '../document-presentation';`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 0, JSON.stringify(diagnostics));
  }
);
