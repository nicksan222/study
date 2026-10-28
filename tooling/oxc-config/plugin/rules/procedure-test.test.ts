import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const testMessage = 'A procedure exporting run must have a sibling .test.ts file.';

test('procedure run exports require a sibling test, while helpers and routers do not', () => {
  const diagnostics = lintRule('procedure-test', {
    'src/procedures/projects/missing.ts': 'export const run = 1;\n',
    'src/procedures/projects/covered.ts': 'export const run = 1;\n',
    'src/procedures/projects/covered.test.ts': 'export {};\n',
    'src/procedures/projects/helper.ts': 'export function helper() {}\n',
    'src/procedures/projects/router.ts': 'export const router = {};\n',
    'src/runtime/run.ts': 'export const run = 1;\n'
  });

  assertDiagnostics('procedure-test', diagnostics, [
    ['src/procedures/projects/missing.ts', testMessage]
  ]);
});

test('procedure function and aliased run exports are checked without classifying type exports', () => {
  const diagnostics = lintRule('procedure-test', {
    'src/procedures/projects/function.ts': 'export function run() {}\n',
    'src/procedures/projects/alias.ts': 'const procedure = 1;\n\nexport { procedure as run };\n',
    'src/procedures/projects/types.ts': "export type { run } from '#backend/shared/safe';\n",
    'src/procedures/projects/already.test.ts': 'export const run = 1;\n',
    'src/procedures/projects/not-run.ts': 'export const runtime = 1;\n'
  });

  assertDiagnostics('procedure-test', diagnostics, [
    ['src/procedures/projects/alias.ts', testMessage],
    ['src/procedures/projects/function.ts', testMessage]
  ]);
});

test('folder procedures require procedure.test.ts and old test setup imports are rejected', () => {
  const diagnostics = lintRule('procedure-test', {
    'src/procedures/projects/missing/procedure.ts': 'export const run = 1;\n',
    'src/procedures/projects/covered/procedure.ts': 'export const run = 1;\n',
    'src/procedures/projects/covered/procedure.test.ts':
      "import { fixture as f } from '#testing/procedures';\nvoid f;\n",
    'src/procedures/projects/database/procedure.test.ts':
      "import { createTestDatabase as openDb } from '@study/db/testing';\nvoid openDb;\n",
    'src/procedures/projects/legacy/procedure.test.ts':
      "export { caller as call } from '#testing/automatic';\n",
    'src/procedures/projects/namespace/procedure.test.ts':
      "import * as setup from '#testing/procedures';\nvoid setup['fixture'];\n",
    'src/procedures/projects/wildcard/procedure.test.ts': "export * from '@study/db/testing';\n"
  });

  assertDiagnostics('procedure-test', diagnostics, [
    [
      'src/procedures/projects/covered/procedure.test.ts',
      'Procedure tests must use createBackendTest(t); fixture, caller and testDatabase setup APIs are forbidden.'
    ],
    [
      'src/procedures/projects/database/procedure.test.ts',
      'Procedure tests must use createBackendTest(t); fixture, caller and testDatabase setup APIs are forbidden.'
    ],
    [
      'src/procedures/projects/legacy/procedure.test.ts',
      'Procedure tests must use createBackendTest(t); fixture, caller and testDatabase setup APIs are forbidden.'
    ],
    [
      'src/procedures/projects/missing/procedure.ts',
      'A folder procedure must have a sibling procedure.test.ts file.'
    ],
    [
      'src/procedures/projects/namespace/procedure.test.ts',
      'Procedure tests must use createBackendTest(t); fixture, caller and testDatabase setup APIs are forbidden.'
    ],
    [
      'src/procedures/projects/wildcard/procedure.test.ts',
      'Procedure tests must use createBackendTest(t); fixture, caller and testDatabase setup APIs are forbidden.'
    ]
  ]);
});
