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
      `import { definePlugin } from 'vite-plus/lint/plugins';\nimport rules from ${JSON.stringify(join(root, 'tooling/oxc-config/plugin/observability-rules.ts'))};\nexport default definePlugin({ meta: { name: 'study' }, rules });`
    );
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        jsPlugins: [{ name: 'study', specifier: join(dir, 'plugin.mjs') }],
        categories: { correctness: 'off' },
        rules: { 'study/operation-conventions': 'error' }
      })
    );

    for (const [path, source] of Object.entries(files)) {
      const file = join(dir, path);

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
        ...Object.keys(files).map((path) => join(dir, path))
      ],
      { encoding: 'utf8', cwd: root }
    );

    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);

    return (JSON.parse(result.stdout) as { diagnostics: { filename: string }[] }).diagnostics
      .map((d) => d.filename.slice(dir.length + 1))
      .sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('checks literal store roles, names and collection input and service public reads', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/a/store/index.ts': `import { Schema as S } from 'effect'; import { defineStore as create, storeQuery as query } from '#server/platform/definitions/define-store'; const f = create; export const A = f({ entity: { singular: 'item', plural: 'items' }, make: ({db}) => ({queries: { getItem: query({role:'required', input: S.String}), items: query({role:'collection', input: S.Struct({})}) }, mutations: {}}) });`,
      'apps/server/src/features/b/store/index.ts': `import * as api from '#server/platform/definitions/define-store'; export const B = api.defineStore({ entity: { singular:'item', plural:'items' }, make: ({db}) => ({queries: { item: api.storeQuery({role:'required'}), findItem: api.storeQuery({role:'optional'}), items: api.storeQuery({role:'collection', input: S.Struct({limit:S.Int})}) }, mutations:{}}) });`,
      'apps/server/src/features/c/service/index.ts': `import { defineService as create } from '#server/platform/definitions/define-service'; import { Effect } from 'effect'; const getLocal = () => 1; export const C = create('C', Effect.gen(function* () { return { getItem: () => x, saveItem: () => x }; }));`,
      'apps/server/src/features/f/store/index.ts': `import { Schema as S } from 'effect'; import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({entity: {singular:'item', plural:'items'}, make: ({db}) => ({queries:{items: storeQuery({role:'collection', input:S.Struct({limit:S.String})})}, mutations:{}})});`,
      'apps/server/src/features/e/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({entity: {singular:'item', plural:'items'}, make: ({db}) => ({queries:{item: storeQuery({input:S.String})}, mutations:{}})});`,
      'apps/server/src/features/d/service/index.ts': `import { defineService } from '#server/platform/definitions/define-service'; function f(defineService) { return defineService('x', {getItem(){}}); }`
    }),
    [
      'apps/server/src/features/a/store/index.ts',
      'apps/server/src/features/a/store/index.ts',
      'apps/server/src/features/c/service/index.ts',
      'apps/server/src/features/e/store/index.ts',
      'apps/server/src/features/f/store/index.ts'
    ]
  );
});

test('schema field composition relies on runtime bounds when the imported shape is opaque', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/learning/store/index.ts': `import { Schema } from 'effect'; import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; import { pageInput } from '@study/contracts/learning/rpc'; defineStore({ entity: {singular:'card', plural:'cards'}, make: ({db}) => ({ queries: { cards: storeQuery({role:'collection',input:Schema.Struct({...pageInput.fields, newCardsPerDay:Schema.Int}), run: input => input}) }, mutations: {} }) });`
    }),
    []
  );
});

test('checks queries returned by a store make callback', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/items/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({ entity: { singular: 'item', plural: 'items' }, make: ({db}) => ({ queries: { getItem: storeQuery({ role: 'required' }) }, mutations: {} }) });`
    }),
    ['apps/server/src/features/items/store/index.ts']
  );
});
