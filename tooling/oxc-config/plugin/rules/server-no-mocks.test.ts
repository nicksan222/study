import { test } from '@study/testing';

import { assertDiagnostics, lintFiles, lintRule } from '../test/utils.ts';

const message =
  'Server tests must use real dependencies, not mock APIs or fabricated database contexts.';

test.unit.stable(
  'server tests reject mock module access and fabricated database contexts',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'server-no-mocks', {
      'test/node-dynamic.ts': "const runner = import('node:test');\n",
      'test/dynamic.ts': "const mock = import('jest-mock');\n",
      'test/cast.ts': `import type { ServerContext as Context } from '#server/runtime/context';

const fake = {} as unknown as Context;

`,
      'test/db-alias.ts':
        "import type { Db as Database } from '@study/db';\nconst fake = {} as Database;\n",
      'test/namespace-cast.ts':
        "import type * as runtime from '@study/server/runtime';\nconst fake = {} as runtime.App;\n",
      'test/db-namespace.ts':
        "import type * as database from '@study/db';\nconst fake = {} as database.Db;\n",
      'test/relative.ts': `import type { App as RuntimeApp } from '../src/runtime/service.ts';

const fake = {} as RuntimeApp;

`,
      'test/other-type.ts':
        "import type { App } from './unrelated.ts';\nconst value = {} as App;\n",
      'test/shadow.ts': `import type { App } from '@study/server/runtime';

function example() { type App = { name: string };
 return {} as App;
 }
`,
      'test/local-type.ts': 'type App = { name: string };\nconst value = {} as App;\n',
      'test/good.ts': `import { test } from '@study/testing';

import { createTestDatabase } from '@study/db/testing';

const db = createTestDatabase();

`,
      'src/runtime/production.ts': "import * as vitest from 'vitest';\n"
    });

    assertDiagnostics({ assert, expect }, 'server-no-mocks', diagnostics, [
      ['test/node-dynamic.ts', message],
      ['test/dynamic.ts', message],
      ['test/cast.ts', message],
      ['test/db-alias.ts', message],
      ['test/namespace-cast.ts', message],
      ['test/db-namespace.ts', message],
      ['test/relative.ts', message]
    ]);
  }
);

test.unit.stable(
  'allows assertion exports while rejecting mock exports in production config',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintFiles(
      { assert },
      {
        'test/assertions.ts': "export { assert, expect } from 'vite-plus/test';",
        'test/mock-export.ts': "export { vi as mocking } from 'vite-plus/test';",
        'test/mock-namespace.ts': "import * as runner from 'vite-plus/test'; export { runner };"
      }
    );

    assert.ok(!diagnostics.some(({ filename }) => filename.endsWith('/assertions.ts')));

    for (const file of ['mock-export.ts', 'mock-namespace.ts'])
      assert.ok(
        diagnostics.some(
          ({ filename, code }) =>
            filename.endsWith('/' + file) && code.includes('no-restricted-imports')
        )
      );
  }
);
