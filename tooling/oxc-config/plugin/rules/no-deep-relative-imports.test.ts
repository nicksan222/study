import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable(
  'reports relative imports that ascend two or more levels across module edge forms',
  async () => {
    const diagnostics = await lintRule('no-deep-relative-imports', {
      'src/a.ts':
        "import '../x'; import '../../x'; export * from './../../../x'; type T = import('..\\\\..\\\\x').T; import x = require('./../../x'); const y = import('../folder/../../x'); require('../../x');"
    });

    assert.strictEqual(diagnostics.length, 6, JSON.stringify(diagnostics));
    assert.ok(
      diagnostics.every(
        ({ message }) =>
          message ===
          'Define a package import alias instead of traversing two or more parent levels.'
      )
    );
  }
);

testStable('allows shallow and non-import strings and respects shadowed require', async () => {
  const diagnostics = await lintRule('no-deep-relative-imports', {
    'src/a.ts':
      "import './x'; import '../x'; const text = '../../x'; function f(require: (s: string) => void) { require('../../x'); }"
  });

  expect(diagnostics).toStrictEqual([]);
});
