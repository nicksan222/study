import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'rejects assertion modules and test-runner imports in production code',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'assertion-boundary', {
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

    assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'blocks runner wrappers in production while permitting the canonical adapter and test helpers',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
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

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics[0]?.filename.endsWith('/production.ts'));
  }
);

test.unit.stable(
  'allows the public test policy only in canonical runner configuration files',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'assertion-boundary',
      {
        'vite.config.ts': "import { testPolicy } from '@study/testing';",
        'apps/client/playwright.config.ts': "import { testPolicy } from '@study/testing';",
        'apps/server/src/runtime/config.ts': "import { testPolicy } from '@study/testing';"
      },
      true
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.filename.endsWith('/apps/server/src/runtime/config.ts')).toBe(true);
  }
);
