import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule, lintRulePaths } from '../test/utils.ts';

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

testStable(
  'browser interactions use locators while keyboard input and navigation remain valid',
  async () => {
    const diagnostics = await lintRule(
      'web-e2e-harness',
      {
        'apps/web/test/e2e/helper.ts': `
      async function journey({ page: browser }) {
        await browser.goto('/notes');
        await browser.reload();
        await expect(browser).toHaveURL(/notes/);
        const dialog = browser.getByRole('dialog');
        await dialog.getByLabel('Title').fill('Notes');
        await dialog.getByText('Save').click();
        await browser.getByTestId('editor').press('Enter');
        await browser.locator('textarea').fill('Text');
        await dialog.locator('button').filter({ hasText: 'Save' }).first().click();
        await dialog.scrollIntoViewIfNeeded();
        await dialog.focus();
        await browser.frameLocator('iframe').getByRole('button').click();
        await browser.getByRole('button').dragTo(dialog);
        await browser.getByRole('textbox').pressSequentially('text');
        const otherOptions = { force: true };
        otherClient.click(otherOptions);
        await browser.keyboard.press('Enter');
        const { keyboard } = browser;
        await keyboard.type('Text');
        await browser.getByRole('checkbox').check({ force: false });
        const { click: activate } = dialog;
        await activate();
      }
      const first = second; const second = first; first.click();
      function shadowed() { const page = service; page.click(); }
      function helper(target: Locator, other: Service) {
        target.click(); target.fill('Text'); target.press('Enter');
        other.evaluate(); other.click(); other.mouse.move(1, 2);
      }
    `,
        'apps/web/test/e2e/harness/private.ts': `
      page.evaluate(() => document.body.click());
      page.mouse.click(1, 2); page.click('button', { force: true });
    `
      },
      true
    );

    assert.deepStrictEqual(diagnostics, []);
  }
);

testStable(
  'public helpers reject browser DOM shortcuts, selector actions, coordinates and forced actions',
  async () => {
    const cases = [
      ...[
        'evaluate',
        'evaluateHandle',
        '$',
        '$$',
        '$eval',
        '$$eval',
        'waitForSelector',
        'click',
        'dblclick',
        'fill',
        'type',
        'check',
        'uncheck',
        'setChecked',
        'press',
        'hover',
        'focus',
        'tap',
        'selectOption',
        'setInputFiles',
        'dispatchEvent',
        'dragAndDrop'
      ].map((method) => `page[${JSON.stringify(method)}]('button');`),
      'page.getByRole("button").evaluate(fn);',
      'page.locator("button").evaluateAll(fn);',
      'page.locator("button").elementHandle();',
      'page.locator("button").elementHandles();',
      'page.mouse.click(1, 2);',
      'page.mouse.move(1, 2);',
      'page["mouse"]["click"](1, 2);',
      'const pointer = page.mouse; pointer.down();',
      'const { mouse: pointer } = page; pointer.wheel(0, 100);',
      'const browser = page; browser["click"]("button");',
      'const { click: activate } = page; activate("button");',
      'const evaluate = page.evaluate; evaluate(fn);',
      'const { ["evaluate"]: run } = page; run(fn);',
      'const browser = page; const { evaluate: run } = browser; run(fn);',
      'async function journey({ page: browser }) { browser.fill("input", "text"); }',
      'async function helper(browser: Page) { browser.press("input", "Enter"); }',
      'async function helper(child: Frame) { child.click("button"); }',
      'page.frame({ name: "child" }).click("button");',
      'page.mainFrame().evaluate(fn);',
      'page.frames()[0].click("button");',
      'page.getByRole("button").click({ force: true });',
      'const button = page.locator("button"); button.click({ ["force"]: true });',
      'const options = { force: true }; page.getByText("Save").click(options);',
      'const button = page.getByText("Save"); const { click: activate } = button; activate({ force: true });',
      'async function helper(target: Locator) { target.click({ force: true }); }',
      'const forced = true; page.getByText("Save").click({ force: forced });',
      'page.getByText("Save").dragTo(target, { force: true });',
      'async function helper(handle: ElementHandle) { handle.click(); }'
    ];
    const files = Object.fromEntries(
      cases.map((source, index) => [
        `apps/web/test/e2e/helper-${index}${index % 2 ? '.test' : ''}.ts`,
        source
      ])
    );
    const diagnostics = await lintRule('web-e2e-harness', files, true);

    assert.deepStrictEqual(
      diagnostics.map(({ filename }) => filename.split('/').at(-1)).sort(),
      Object.keys(files)
        .map((filename) => filename.split('/').at(-1))
        .sort(),
      JSON.stringify(diagnostics)
    );
  }
);

testStable('screenshot readiness must await or return a matcher in its own callback', async () => {
  const cases = [
    ['() => expect(page.getByRole("heading")).toBeVisible()', true],
    ['async () => await expect(page.getByRole("heading")).toBeVisible()', true],
    ['async () => { await expect(page.getByRole("heading")).toBeVisible(); }', true],
    ['() => { return expect(page.getByRole("heading")).toBeVisible(); }', true],
    ['async () => { return await expect(page.getByRole("heading")).toBeVisible(); }', true],
    ['async () => { expect(page.getByRole("heading")).toBeVisible(); }', false],
    ['async () => { await expect(page.getByRole("heading")); }', false],
    [
      'async () => { const later = async () => { await expect(page.getByRole("heading")).toBeVisible(); }; }',
      false
    ]
  ] as const;

  for (const [ready, valid] of cases) {
    const diagnostics = await lintRule(
      'web-e2e-harness',
      {
        'apps/web/test/e2e/readiness.test.ts': `import { testE2e, expect } from './harness/index.ts'; testE2e('Notes retain edits', async ({ page, expectScreenshot }) => { await expectScreenshot('ready', { target: 'viewport', ready: ${ready} }); });`
      },
      true
    );

    assert.strictEqual(diagnostics.length, valid ? 0 : 1, ready);
  }
});

testStable('forced locator options follow static spreads in last-property order', async () => {
  const rejected = [
    'button.click({ ...{ force: true } })',
    'button.click({ ...{ ...{ force: true } } })',
    'button.click({ force: false, ...forced })',
    'button.click({ ...safe, ...forced })',
    'button.click({ ...unknown })',
    'button.click({ force: false, ...unknown })',
    'button.click(unknown)',
    'button.click({ force: true, ...{ timeout: 10 } })',
    'button.click({ ...cycle })',
    'button.fill(text, { ...forced })',
    'button.dragTo(target, { ...forced })',
    'button.clear({ force: true })',
    'button.selectText({ ...forced })'
  ];
  const allowed = [
    'button.click({ ...forced, force: false })',
    'button.click({ ...forced, ...safe })',
    'button.click({ ...unknown, force: false })',
    'button.click({ ...{ ...forced, force: false } })',
    'button.click({ ...safe, ...safe })',
    'button.click({ ...{ timeout: 10 } })',
    'button.fill(text)',
    'button.press(key)',
    'button.selectOption(value)',
    'button.setInputFiles(files)',
    'button.dragTo(target)',
    'button.clear()',
    'button.clear({ force: false })',
    'button.selectText()',
    'button.selectText({ ...safe })',
    'button.dispatchEvent(event, payload)',
    'other.click({ ...forced })'
  ];

  const files = Object.fromEntries(
    [...rejected, ...allowed].map((call, index) => [
      `apps/web/test/e2e/helper-${index}.ts`,
      `const forced = { force: true }; const safe = { force: false };
     const cycle = { ...cycle }; const button = page.getByRole('button');
     ${call};`
    ])
  );

  assert.deepStrictEqual(
    await lintRulePaths('web-e2e-harness', files),
    Object.keys(files).slice(0, rejected.length).sort()
  );
});

testStable(
  'typed browser parameter patterns reject selector actions and allow locator actions',
  async () => {
    const rejected = [
      "async function helper({ click }: Page) { await click('button'); }",
      "const helper = async ({ fill: enter }: Frame) => { await enter('input', 'text'); };",
      "const helper = async function ({ click: activate = fallback }: Page) { await activate('button'); };",
      "async function helper({ click }: Frame = frame) { await click('button'); }"
    ];
    const allowed = [
      'async function helper({ click }: Locator) { await click(); }',
      'const helper = async ({ fill: enter }: Locator) => { await enter("text"); };',
      'async function helper({ click }: Service) { await click("button"); }',
      'async function helper({ goto, keyboard }: Page) { await goto("/"); await keyboard.press("Enter"); }'
    ];

    const files = Object.fromEntries(
      [...rejected, ...allowed].map((source, index) => [
        `apps/web/test/e2e/helper-${index}.ts`,
        source
      ])
    );

    assert.deepStrictEqual(
      await lintRulePaths('web-e2e-harness', files),
      Object.keys(files).slice(0, rejected.length).sort()
    );
  }
);
