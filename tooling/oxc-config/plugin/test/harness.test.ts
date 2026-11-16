import { test } from '@study/testing';

import { lintRule } from './utils.ts';

test.stable('isolated rule ignores unrelated default lint violations', async () => {
  const diagnostics = await lintRule('browser-boundary', {
    'src/shared/unused.ts': 'const unused = 1;\n'
  });

  test.expect(diagnostics).toStrictEqual([]);
});

test.stable('isolated rule loads the plugin and reports its diagnostic and path', async () => {
  const diagnostics = await lintRule('browser-boundary', {
    'src/shared/bad.ts': "export * from '#server/runtime/context';\n"
  });

  test.assert.strictEqual(diagnostics.length, 1);
  test.assert.strictEqual(diagnostics[0]!.code, 'study(browser-boundary)');
  test.assert.ok(diagnostics[0]!.filename.endsWith('/src/shared/bad.ts'));
});
