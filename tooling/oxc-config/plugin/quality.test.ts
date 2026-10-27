import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

const vp = join(root, 'node_modules/.bin/vp');

type Diagnostic = {
  code: string;
  filename: string;
  message: string;
};

function lintFiles(files: Record<string, string>): Diagnostic[] {
  const temporaryRoot = tmpdir();

  mkdirSync(temporaryRoot, { recursive: true });

  const directory = mkdtempSync(join(temporaryRoot, 'oxlint-quality-'));
  const backend = join(directory, 'packages/backend');

  try {
    for (const [name, source] of Object.entries(files)) {
      const filename = join(backend, name);

      mkdirSync(dirname(filename), { recursive: true });
      writeFileSync(filename, source);
    }

    const result = spawnSync(
      vp,
      [
        'lint',
        '--config',
        join(root, 'vite.config.ts'),
        '--no-ignore',
        '--format',
        'json',
        backend
      ],
      {
        cwd: root,
        encoding: 'utf8'
      }
    );

    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr || result.stdout);

    const output = JSON.parse(result.stdout) as { diagnostics: Diagnostic[] };

    assert.equal(result.status, output.diagnostics.length ? 1 : 0, result.stderr);

    return output.diagnostics;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('procedure run exports require a sibling test, while helpers and routers do not', () => {
  const diagnostics = lintFiles({
    'src/procedures/projects/missing.ts': 'export const run = 1;\n',
    'src/procedures/projects/covered.ts': 'export const run = 1;\n',
    'src/procedures/projects/covered.test.ts': 'export {};\n',
    'src/procedures/projects/helper.ts': 'export function helper() {}\n',
    'src/procedures/projects/router.ts': 'export const router = {};\n',
    'src/runtime/run.ts': 'export const run = 1;\n'
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.match(diagnostics[0]!.code, /procedure-test/);
  assert.match(diagnostics[0]!.filename, /missing\.ts$/);
});

test('procedure function and aliased run exports are checked without classifying type exports', () => {
  const diagnostics = lintFiles({
    'src/procedures/projects/function.ts': 'export function run() {}\n',
    'src/procedures/projects/alias.ts': 'const procedure = 1;\n\nexport { procedure as run };\n',
    'src/procedures/projects/types.ts': "export type { run } from '#backend/shared/safe';\n",
    'src/procedures/projects/already.test.ts': 'export const run = 1;\n',
    'src/procedures/projects/not-run.ts': 'export const runtime = 1;\n'
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ code }) => code.includes('procedure-test')));
});

test('shared and client modules allow type references but reject backend value edges', () => {
  const diagnostics = lintFiles({
    'src/shared/type-import.ts':
      "import type { BackendContext } from '#backend/runtime/context';\n\nexport type Context = BackendContext;\n",
    'src/shared/type-export.ts': "export type { rowJob } from '#backend/procedures/jobs/worker';\n",
    'src/client/type-db.ts': "export type { jobs } from '@study/db/schema';\n",
    'src/shared/error.ts': "export { DrizzleQueryError } from 'drizzle-orm';\n",
    'src/client/safe.ts': "export { value } from '#backend/shared/safe';\n",
    'src/shared/safe.ts': 'export const value = 1;\n',
    'src/shared/bad-import.ts':
      "import { appRouter } from '#backend/runtime/router';\n\nexport { appRouter };\n",
    'src/shared/bad-db.ts': "export { jobs } from '@study/db/schema';\n",
    'src/shared/bad-runtime.ts': "export * from '#backend/runtime/context';\n",
    'src/client/bad-procedure.ts':
      "export { run } from '#backend/procedures/projects/create-project';\n",
    'src/client/bad-relative.ts': "export * from './../runtime/context.ts';\n",
    'src/client/bad-side-effect.ts': "import '@study/db';\n",
    'src/index.ts': "export * from './runtime/router.ts';\n",
    'src/runtime/allowed.ts': "export * from '@study/db';\n"
  });
  const boundaries = diagnostics.filter(({ code }) => code.includes('browser-boundary'));

  assert.equal(boundaries.length, 7, JSON.stringify(diagnostics));
  assert.ok(boundaries.every(({ filename }) => /(?:bad-[^/]+|index)\.ts$/.test(filename)));
  assert.equal(diagnostics.length, boundaries.length, JSON.stringify(diagnostics));
});

test('dynamic backend imports also respect browser boundaries and import types stay legal', () => {
  const diagnostics = lintFiles({
    'src/shared/dynamic-runtime.ts': "export const runtime = import('#backend/runtime/context');\n",
    'src/client/dynamic-db.ts': "export const database = import('@study/db');\n",
    'src/client/type-query.ts':
      "import type { createProject } from '#backend/procedures/projects/create-project';\n\nexport type Project = ReturnType<typeof createProject>;\n"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ code }) => code.includes('browser-boundary')));
});

test('whole import type remains enforced by built-in rules without a boundary false positive', () => {
  const diagnostics = lintFiles({
    'src/shared/inline-type.ts':
      "import { type BackendContext } from '#backend/runtime/context';\n\nexport type Context = BackendContext;\n"
  });

  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every(({ code }) => !code.includes('browser-boundary')));
  assert.ok(diagnostics.some(({ code }) => code.includes('consistent-type-specifier-style')));
});

test('backend cross-directory imports use package aliases and sibling imports stay legal', () => {
  const diagnostics = lintFiles({
    'src/runtime/bad-import.ts':
      "import type { Value } from '../shared/safe.ts';\n\nexport type Next = Value;\n",
    'src/runtime/bad-export.ts': "export * from '../shared/safe.ts';\n",
    'src/runtime/bad-dynamic.ts': "export const value = import('../shared/safe.ts');\n",
    'src/runtime/good-backend.ts': "export { value } from '#backend/shared/safe';\n",
    'test/good-testing.ts': "export { helper } from '#testing/procedures';\n",
    'src/shared/safe.ts': 'export const value = 1;\n\nexport type Value = number;\n',
    'src/shared/sibling.ts': "export { value } from './safe.ts';\n"
  });

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ code }) => code.includes('no-restricted-imports')));
});

test('Node resolves and loads extensionless nested backend and testing aliases', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import assert from 'node:assert/strict';
    import { fileURLToPath } from 'node:url';
    for (const [specifier, suffix] of [
      ['#backend/shared/json', '/src/shared/json.ts'],
      ['#backend/shared/errors/index', '/src/shared/errors/index.ts'],
      ['#testing/procedures', '/test/testing/procedures.ts']
    ]) {
      assert.ok(fileURLToPath(import.meta.resolve(specifier)).endsWith(suffix));
      await import(specifier);
    }
  `
    ],
    { cwd: join(root, 'packages/backend'), encoding: 'utf8' }
  );

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('backend tests reject Node mock imports and context mocking through built-in rules', () => {
  const diagnostics = lintFiles({
    'test/mock-context.test.ts':
      "import { test } from 'node:test';\n\ntest('mocked method', (t) => { t.mock.method(Math, 'random', () => 0.5); });\n",
    'test/mock-import.ts':
      "import { mock as tracker } from 'node:test';\n\nexport const mocking = tracker;\n",
    'test/mock-destructure.ts':
      'export function tracker(context: { mock: unknown }) { const { mock: tracker } = context;\n\nreturn tracker; }\n',
    'test/real.test.ts':
      "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\n\ntest('real value', (t) => { t.after(() => {}); assert.equal(Math.max(1, 2), 2); });\n"
  });

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
  assert.equal(
    diagnostics.filter(({ code }) => code.includes('no-restricted-properties')).length,
    2
  );
  assert.equal(diagnostics.filter(({ code }) => code.includes('no-restricted-imports')).length, 1);
  assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/real.test.ts')));
});

test('backend tests reject Vitest and Jest mocking imports', () => {
  const diagnostics = lintFiles({
    'test/vitest.ts': "export { vi as mocking } from 'vitest';\n",
    'test/vite-plus.ts': "export { vi as mocking } from 'vite-plus/test';\n",
    'test/jest.ts': "export { jest as mocking } from '@jest/globals';\n",
    'test/jest-mock.ts': "export { fn } from 'jest-mock';\n"
  });

  const restrictedImports = diagnostics.filter(({ code }) =>
    code.includes('no-restricted-imports')
  );

  assert.equal(restrictedImports.length, 4, JSON.stringify(diagnostics));
  assert.ok(
    diagnostics.every(
      ({ code }) =>
        code.includes('no-restricted-imports') || code.includes('prefer-vite-plus-imports')
    )
  );
});
