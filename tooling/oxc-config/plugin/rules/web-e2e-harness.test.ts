import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable(
  'journeys use the direct harness API and await explicit screenshot readiness',
  async () => {
    const diagnostics = await lintRule(
      'web-e2e-harness',
      {
        'apps/web/test/e2e/good.test.ts':
          "import { expect, testE2e } from './harness/index.ts'; testE2e('Notes retain edits', async ({ page, expectScreenshot }) => { await page.goto('/notes'); await expectScreenshot('ready', { target: 'viewport', ready: () => expect(page.getByRole('heading')).toBeVisible() }); });",
        'apps/web/test/e2e/bad.test.ts':
          "import { testE2e } from './harness/index.ts'; testE2e('Notes retain edits', async ({ page }) => { await page.goto('/notes'); });",
        'apps/web/test/e2e/old.test.ts':
          "import { testE2e } from './harness/index.ts'; testE2e('Notes retain edits', async ({ checkpoint }) => { await checkpoint('ready', { target: 'viewport', ready: () => expect(page.getByRole('heading')).toBeVisible() }); });"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable('browser specs cannot own resources, mock requests or use fixed waits', async () => {
  const diagnostics = await lintRule(
    'web-e2e-harness',
    {
      'apps/web/test/e2e/bad.test.ts':
        "import { chromium } from 'playwright'; import { createTestDatabase } from '@study/db/testing'; import { serve } from '@study/server/runtime'; page.route('**/*', handler); page.waitForTimeout(50);",
      'apps/web/test/e2e/harness/index.ts':
        "import { chromium } from 'playwright'; chromium.launch();"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
});

testStable('aliases cannot conceal interception or global timers', async () => {
  const diagnostics = await lintRule(
    'web-e2e-harness',
    {
      'apps/web/test/e2e/helper.ts':
        'const delay = setTimeout; const intercept = page.routeWebSocket; globalThis.setTimeout(fn, 10); const { routeFromHAR } = page;'
    },
    true
  );

  assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
});

testStable('opaque and concurrent registrations cannot bypass the fixture boundary', async () => {
  const diagnostics = await lintRule(
    'web-e2e-harness',
    {
      'apps/web/test/e2e/bad.test.ts':
        "import { testE2e } from './harness/index.ts'; testStable('opaque', callback); testE2e.concurrent('parallel', async () => {}); testStable.each([1])('parameterized', async () => {});"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

testStable(
  'unawaited captures, missing readiness and anonymous titles fail conventions',
  async () => {
    const diagnostics = await lintRule(
      'web-e2e-harness',
      {
        'apps/web/test/e2e/bad.test.ts':
          "import { testE2e } from './harness/index.ts'; testE2e('W001', async ({ expectScreenshot }) => { await expectScreenshot('ready', { target: 'viewport' }); }); testE2e('Notes retain edits', async ({ expectScreenshot }) => { expectScreenshot('ready', { target: 'viewport', ready: () => expect(page.getByRole('heading')).toBeVisible() }); });"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable(
  'empty readiness callbacks and internal fixture imports cannot bypass conventions',
  async () => {
    const diagnostics = await lintRule(
      'web-e2e-harness',
      {
        'apps/web/test/e2e/bad.test.ts':
          "import { testE2e } from './harness/index.ts'; import { testWeb } from './harness/worker.ts'; testE2e('Notes retain edits', async ({ expectScreenshot }) => { await expectScreenshot('ready', { target: 'viewport', ready: async () => {} }); }); Bun.sleep(10);"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable('internal fixtures and aliased public imports are rejected', async () => {
  const diagnostics = await lintRule(
    'web-e2e-harness',
    {
      'apps/web/test/e2e/bad.test.ts':
        "import { testHarness, testE2e as hidden } from './harness/index.ts'; hidden('Notes retain edits', async () => {});",
      'apps/web/test/e2e/aliased.test.ts': "import { expect as hidden } from './harness/index.ts';",
      'apps/web/test/e2e/removed.test.ts': "import { expect } from './harness/assertions.ts';"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});
