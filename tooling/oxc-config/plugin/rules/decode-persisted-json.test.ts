import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('decode-persisted-json guards production and accepts safe alternatives', () => {
  const diagnostics = lintRule('decode-persisted-json', {
    'src/bad.ts': 'const body = JSON.parse(row.body) as ArtifactBody;',
    'src/good.ts':
      'const body = bodySchema.parse(JSON.parse(row.body)); const raw: unknown = JSON.parse(text);',
    'src/fixture.test.ts': 'const body = JSON.parse(row.body) as ArtifactBody;'
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('decode-persisted-json handles aliases and avoids unrelated bindings', () => {
  const diagnostics = lintRule('decode-persisted-json', {
    'src/bad.ts': 'const domain = JSON.parse(value) as Body;',
    'src/good.ts':
      'function f(JSON) { return JSON.parse(value) as Body; } const value = Schema.decodeUnknownSync(bodySchema)(JSON.parse(row.body));'
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('decode-persisted-json covers direct unsafe forms', () => {
  const diagnostics = lintRule('decode-persisted-json', {
    'src/bad.ts': 'const domain: Body = JSON.parse(row.body);',
    'src/good.ts': 'const raw: unknown = JSON.parse(row.body);'
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});
