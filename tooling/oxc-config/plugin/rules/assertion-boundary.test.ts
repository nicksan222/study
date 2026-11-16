import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable('rejects assertion modules and test-runner imports in production code', async () => {
  const diagnostics = await lintRule('assertion-boundary', {
    'src/a.ts': `import a from 'node:assert';
 export * from 'assert/strict';
 const b = require('node:assert/strict');
 import('assert');
 import { expect } from 'vite-plus/test';
`,
    'src/a.test.ts': `import { expect } from 'vite-plus/test';
 const fixture = "import a from 'assert'";
 function f(require: (x: string) => unknown) { require('assert');
 }`
  });

  test.assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
});

test.stable(
  'blocks runner wrappers in production while permitting the canonical adapter and test helpers',
  async () => {
    const diagnostics = await lintRule(
      'assertion-boundary',
      {
        'apps/server/src/production.ts': "import { test } from '@study/testing';",
        'packages/testing/src/vitest.ts': "import { test } from 'vite-plus/test';",
        'apps/server/test/testing/helper.ts': "import { assert } from 'vite-plus/test';",
        'tooling/testing/integrations/fixture.ts':
          "import { temporaryDirectory } from '@study/testing/resources';"
      },
      true
    );

    test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    test.assert.ok(diagnostics[0]?.filename.endsWith('/production.ts'));
  }
);

test.stable(
  'allows the public test policy only in canonical runner configuration files',
  async () => {
    const diagnostics = await lintRule(
      'assertion-boundary',
      {
        'vite.config.ts': "import { testPolicy } from '@study/testing';",
        'apps/client/playwright.config.ts': "import { testPolicy } from '@study/testing';",
        'apps/server/src/runtime/config.ts': "import { testPolicy } from '@study/testing';"
      },
      true
    );

    test.expect(diagnostics).toHaveLength(1);
    test.expect(diagnostics[0]?.filename.endsWith('/apps/server/src/runtime/config.ts')).toBe(true);
  }
);
