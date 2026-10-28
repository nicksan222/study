import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Backend tests must use real dependencies, not mock APIs or fabricated database contexts.';

test('backend tests reject mock module access and fabricated database contexts', () => {
  const diagnostics = lintRule('backend-no-mocks', {
    'test/namespace.ts': "import * as vitest from 'vitest';\n",
    'test/node-dynamic.ts': "const runner = import('node:test');\n",
    'test/dynamic.ts': "const mock = import('jest-mock');\n",
    'test/cast.ts':
      "import type { BackendContext as Context } from '#backend/runtime/context';\nconst fake = {} as unknown as Context;\n",
    'test/db-alias.ts':
      "import type { Db as Database } from '@study/db';\nconst fake = {} as Database;\n",
    'test/namespace-cast.ts':
      "import type * as runtime from '@study/backend/server';\nconst fake = {} as runtime.App;\n",
    'test/db-namespace.ts':
      "import type * as database from '@study/db';\nconst fake = {} as database.Db;\n",
    'test/relative.ts':
      "import type { App as RuntimeApp } from '../src/runtime/service.ts';\nconst fake = {} as RuntimeApp;\n",
    'test/other-type.ts': "import type { App } from './unrelated.ts';\nconst value = {} as App;\n",
    'test/shadow.ts':
      "import type { App } from '@study/backend/server';\nfunction example() { type App = { name: string }; return {} as App; }\n",
    'test/local-type.ts': 'type App = { name: string };\nconst value = {} as App;\n',
    'test/good.ts':
      "import { test } from 'node:test';\nimport { createTestDatabase } from '@study/db/testing';\nconst db = createTestDatabase();\n",
    'src/runtime/production.ts': "import * as vitest from 'vitest';\n"
  });

  assertDiagnostics('backend-no-mocks', diagnostics, [
    ['test/namespace.ts', message],
    ['test/node-dynamic.ts', message],
    ['test/dynamic.ts', message],
    ['test/cast.ts', message],
    ['test/db-alias.ts', message],
    ['test/namespace-cast.ts', message],
    ['test/db-namespace.ts', message],
    ['test/relative.ts', message]
  ]);
});
