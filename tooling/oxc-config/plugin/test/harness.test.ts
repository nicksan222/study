import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { lintRule } from './utils.ts';

testStable('isolated rule ignores unrelated default lint violations', async () => {
  const diagnostics = await lintRule('browser-boundary', {
    'src/shared/unused.ts': 'const unused = 1;\n'
  });

  expect(diagnostics).toStrictEqual([]);
});

testStable('isolated rule loads the plugin and reports its diagnostic and path', async () => {
  const diagnostics = await lintRule('browser-boundary', {
    'src/shared/bad.ts': "export * from '#server/runtime/context';\n"
  });

  assert.strictEqual(diagnostics.length, 1);
  assert.strictEqual(diagnostics[0]!.code, 'study(browser-boundary)');
  assert.ok(diagnostics[0]!.filename.endsWith('/src/shared/bad.ts'));
});
