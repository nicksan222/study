import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable(
  'browser specs use the shared harness and cannot own browser lifecycle or mock requests',
  () => {
    const diagnostics = lintRule(
      'web-e2e-harness',
      {
        'apps/web/test/e2e/good.test.ts':
          "import { withWebE2e } from './harness/index.ts'; testStable('works', async () => { await withWebE2e(async ({ page }) => { await page.getByRole('button').click(); }); });",
        'apps/web/test/e2e/bad.test.ts':
          "import { chromium as browser } from 'playwright'; import { createTestDatabase as database } from '@study/db/testing'; browser.launch(); database(); page.route('**/*', handler); page.waitForTimeout(50);",
        'apps/web/test/e2e/helper.ts': "import { serve } from '@study/server/runtime';",
        'apps/web/test/e2e/harness/index.ts':
          "import { chromium } from 'playwright'; chromium.launch();",
        'apps/web/src/unrelated.ts': "import { chromium } from 'playwright'; chromium.launch();"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
  }
);

testStable(
  'browser specs reject aliased request mocking, fixed waits and unused harness imports',
  () => {
    const diagnostics = lintRule(
      'web-e2e-harness',
      {
        'apps/web/test/e2e/bad.test.ts':
          "import { withWebE2e as fixture } from './harness/index.ts'; testStable('bad', async () => { const mock = page.route; mock('**/*', handler); const delay = page.waitForTimeout; delay(10); });"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable(
  'parameterized and factory registrations require the harness and fixed timers are forbidden',
  () => {
    const diagnostics = lintRule(
      'web-e2e-harness',
      {
        'apps/web/test/e2e/bad.test.ts':
          "import { setTimeout as delay } from 'node:timers/promises'; testStable.each([1])('x', async () => { await delay(2); }); testStable.concurrent('x', async () => { setTimeout(fn, 5); }); testRegression({})('x', async () => {});"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
  }
);

testStable('opaque registrations and nested harness paths do not bypass the boundary', () => {
  const diagnostics = lintRule(
    'web-e2e-harness',
    {
      'apps/web/test/e2e/nested/harness.ts': "import { chromium } from 'playwright';",
      'apps/web/test/e2e/bad.test.ts': "testStable('opaque', callback);",
      'apps/web/test/e2e/good.test.ts':
        "import { withWebE2e as fixture } from './harness/index.ts'; testStable('valid', async () => { await fixture(async () => {}); });"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('aliases cannot hide global timers or websocket request interception', () => {
  const diagnostics = lintRule(
    'web-e2e-harness',
    {
      'apps/web/test/e2e/helper.ts':
        'const wait = setTimeout; const intercept = page.routeWebSocket; globalThis.setTimeout(fn, 10);'
    },
    true
  );

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});
