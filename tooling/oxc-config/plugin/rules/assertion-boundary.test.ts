import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('reports assertion module edges and production runner imports', () => {
  const diagnostics = lintRule('assertion-boundary', {
    'src/a.ts': `import a from 'node:assert'; export * from 'assert/strict'; const b = require('node:assert/strict'); import('assert'); import { expect } from 'vite-plus/test';`,
    'src/a.test.ts': `import { expect } from 'vite-plus/test'; const fixture = "import a from 'assert'"; function f(require: (x: string) => unknown) { require('assert'); }`
  });

  assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
});

testStable(
  'blocks runner wrappers in production while permitting the canonical adapter and test helpers',
  () => {
    const diagnostics = lintRule(
      'assertion-boundary',
      {
        'apps/server/src/production.ts': "import { testStable } from '@study/testing/vitest';",
        'packages/testing/src/vitest.ts': "import { test } from 'vite-plus/test';",
        'apps/server/test/testing/helper.ts': "import { assert } from 'vite-plus/test';"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics[0]?.filename.endsWith('/production.ts'));
  }
);
