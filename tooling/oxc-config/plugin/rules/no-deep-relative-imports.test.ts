import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable(
  'rejects relative imports that ascend two or more directories across module edge forms',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'no-deep-relative-imports', {
      'src/a.ts': `import '../x';
import '../../x';
export * from './../../../x';
type T = import('..\\\\..\\\\x').T;
import x = require('./../../x');
const y = import('../folder/../../x');
require('../../x');`
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

test.stable(
  'allows shallow and non-import strings and respects shadowed require',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'no-deep-relative-imports', {
      'src/a.ts': `import './x';
 import '../x';
 const text = '../../x';
 function f(require: (s: string) => void) { require('../../x');
 }`
    });

    expect(diagnostics).toStrictEqual([]);
  }
);
