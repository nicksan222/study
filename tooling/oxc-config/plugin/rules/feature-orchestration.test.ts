import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Use Effect for feature orchestration; native async, Promise construction and fetch belong at I/O boundaries.';

test('checks canonical feature owners and respects shadowed globals and adapters', () => {
  assertDiagnostics(
    'feature-orchestration',
    lintRule('feature-orchestration', {
      'src/features/sources/service.ts':
        'async function load() {} const f = fetch; f(url); new Promise(resolve => resolve(1)); function local(fetch: any, Promise: any) { fetch(url); new Promise(); }',
      'src/features/sources/fetch.ts': 'globalThis.fetch(url);',
      'src/features/sources/adapter.ts': 'async function io() { return fetch(url); }',
      'src/features/sources/service.test.ts': 'async function io() { return fetch(url); }'
    }),
    [
      ['src/features/sources/service.ts', message],
      ['src/features/sources/service.ts', message],
      ['src/features/sources/service.ts', message],
      ['src/features/sources/fetch.ts', message]
    ]
  );
});

test('recognizes fallback fetch aliases in feature tool directories', () => {
  assertDiagnostics(
    'feature-orchestration',
    lintRule('feature-orchestration', {
      'src/features/a/tools/search.ts': 'const request = options.fetch ?? fetch; request(url);'
    }),
    [['src/features/a/tools/search.ts', message]]
  );
});
