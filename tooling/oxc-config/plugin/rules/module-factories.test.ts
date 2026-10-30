import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { root } from '../test/utils.ts';

function lint(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-rule-'));

  try {
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    writeFileSync(
      join(dir, 'plugin.mjs'),
      `import { definePlugin } from 'vite-plus/lint/plugins';\nimport rules from ${JSON.stringify(join(root, 'tooling/oxc-config/plugin/factory-rules.ts'))};\nexport default definePlugin({ meta: { name: 'study' }, rules });`
    );
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        jsPlugins: [{ name: 'study', specifier: join(dir, 'plugin.mjs') }],
        categories: { correctness: 'off' },
        rules: { 'study/module-factories': 'error' }
      })
    );

    for (const [path, source] of Object.entries(files)) {
      const file = join(dir, 'apps/server/src/features', path);

      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }

    const result = spawnSync(
      join(root, 'node_modules/.bin/oxlint'),
      [
        '--config',
        join(dir, 'config.json'),
        '--no-ignore',
        '--format',
        'json',
        join(dir, 'apps/server')
      ],
      { encoding: 'utf8', cwd: root }
    );

    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);

    return (JSON.parse(result.stdout) as { diagnostics: { filename: string }[] }).diagnostics
      .map((d) => d.filename.split('/features/')[1])
      .sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('only canonical factory results and their service layers are public', () => {
  assert.deepEqual(
    lint({
      'alpha/service/index.ts':
        "import { defineService as create } from '#server/platform/definitions/define-service'; const alias = create; function helper() {} const service = alias('study/Alpha', make); export { service as Alpha }; export const layer = service.layer;",
      'beta/index.ts':
        "import * as api from '#server/platform/definitions/define-service'; const alias = api; export const Beta = alias.defineService('study/Beta', make); export { BetaStore } from './store.ts';",
      'gamma/store/index.ts':
        "import { defineStore as store } from '#server/platform/definitions/define-store'; export default store({make: ({db}) => ({queries: {}, mutations: {}})});",
      'delta/store/index.ts': 'export function query() {}',
      'epsilon/index.ts': "export { query } from './store/query.ts';",
      'zeta/store/index.ts': 'const one = two; const two = one; export { one };',
      'eta/store/query.ts': 'export function query() {}',
      'theta/service/index.ts':
        "import { defineService } from '#server/platform/definitions/define-service'; function make(defineService) { return defineService('study/Theta', x); } export const Theta = make(fake);",
      'iota/store/index.ts':
        "import { defineStore } from '#server/platform/definitions/define-store'; export const Store = defineStore({make: ({db}) => ({queries: {}, mutations: {}})}); export const bad = () => 1;",
      'kappa/index.ts': "export * from './store/queries.ts';",
      'lambda/index.ts': "export { type Input } from './store/query.ts';"
    }),
    [
      'beta/index.ts',
      'delta/store/index.ts',
      'epsilon/index.ts',
      'iota/store/index.ts',
      'kappa/index.ts',
      'theta/service/index.ts',
      'zeta/store/index.ts'
    ]
  );
});

test('store entry requires an exported factory even when it contains only private helpers', () => {
  assert.deepEqual(
    lint({
      'alpha/store/index.ts': 'function helper() { return 1; }',
      'beta/store/index.ts': 'export type Input = string;',
      'gamma/store/query.ts': 'function helper() { return 1; }'
    }),
    ['alpha/store/index.ts', 'beta/store/index.ts']
  );
});

test('nested entry modules cannot avoid canonical construction', () => {
  assert.deepEqual(
    lint({
      'sources/nested/store.ts': 'export const db = {};',
      'sources/nested/service.ts': 'export const Sources = {};'
    }),
    ['sources/nested/service.ts', 'sources/nested/store.ts']
  );
});
