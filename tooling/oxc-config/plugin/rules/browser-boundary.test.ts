import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const boundaryMessage =
  'Shared contracts and clients must use type-only references to server runtime, procedures, and @study/db.';

test('shared and client modules allow type references but reject server value edges', () => {
  const diagnostics = lintRule('browser-boundary', {
    'src/shared/type-import.ts':
      "import type { ServerContext } from '#server/runtime/context';\n\nexport type Context = ServerContext;\n",
    'src/shared/type-export.ts': "export type { rowJob } from '#server/procedures/jobs/worker';\n",
    'src/client/type-db.ts': "export type { jobs } from '@study/db/schema';\n",
    'src/shared/error.ts': "export { DrizzleQueryError } from 'drizzle-orm';\n",
    'src/client/safe.ts': "export { value } from '#server/shared/safe';\n",
    'src/shared/safe.ts': 'export const value = 1;\n',
    'src/shared/bad-import.ts':
      "import { appRouter } from '#server/runtime/router';\n\nexport { appRouter };\n",
    'src/shared/bad-db.ts': "export { jobs } from '@study/db/schema';\n",
    'src/shared/bad-runtime.ts': "export * from '#server/runtime/context';\n",
    'src/client/bad-procedure.ts':
      "export { run } from '#server/procedures/projects/create-project';\n",
    'src/client/bad-relative.ts': "export * from './../runtime/context.ts';\n",
    'src/client/bad-side-effect.ts': "import '@study/db';\n",
    'src/index.ts': "export * from './runtime/router.ts';\n",
    'src/runtime/allowed.ts': "export * from '@study/db';\n"
  });

  assertDiagnostics('browser-boundary', diagnostics, [
    ['src/client/bad-procedure.ts', boundaryMessage],
    ['src/client/bad-relative.ts', boundaryMessage],
    ['src/client/bad-side-effect.ts', boundaryMessage],
    ['src/index.ts', boundaryMessage],
    ['src/shared/bad-db.ts', boundaryMessage],
    ['src/shared/bad-import.ts', boundaryMessage],
    ['src/shared/bad-runtime.ts', boundaryMessage]
  ]);
});

test('dynamic server imports also respect browser boundaries and import types stay legal', () => {
  const diagnostics = lintRule('browser-boundary', {
    'src/shared/dynamic-runtime.ts': "export const runtime = import('#server/runtime/context');\n",
    'src/client/dynamic-db.ts': "export const database = import('@study/db');\n",
    'src/client/type-query.ts':
      "import type { createProject } from '#server/procedures/projects/create-project';\n\nexport type Project = ReturnType<typeof createProject>;\n"
  });

  assertDiagnostics('browser-boundary', diagnostics, [
    ['src/client/dynamic-db.ts', boundaryMessage],
    ['src/shared/dynamic-runtime.ts', boundaryMessage]
  ]);
});
