import { test } from '@study/testing';

import { lintRule } from './utils.ts';

test.stable(
  'isolated rule ignores unrelated default lint violations',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'browser-boundary', {
      'src/shared/unused.ts': 'const unused = 1;\n'
    });

    expect(diagnostics).toStrictEqual([]);
  }
);

test.stable(
  'isolated rule loads the plugin and reports its diagnostic and path',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'browser-boundary', {
      'src/shared/bad.ts': "export * from '#server/runtime/context';\n"
    });

    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0]!.code, 'study(browser-boundary)');
    assert.ok(diagnostics[0]!.filename.endsWith('/src/shared/bad.ts'));
  }
);
