import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from './utils.ts';

test('isolated rule ignores unrelated default lint violations', () => {
  const diagnostics = lintRule('browser-boundary', {
    'src/shared/unused.ts': 'const unused = 1;\n'
  });

  assert.deepEqual(diagnostics, []);
});

test('isolated rule loads the plugin and reports its diagnostic and path', () => {
  const diagnostics = lintRule('browser-boundary', {
    'src/shared/bad.ts': "export * from '#server/runtime/context';\n"
  });

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.code, 'study(browser-boundary)');
  assert.ok(diagnostics[0]!.filename.endsWith('/src/shared/bad.ts'));
});
