import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'rejects raw runner imports including aliases, namespaces and default imports',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    for (const source of [
      "import { test } from 'node:test'; test('raw', () => {});",
      "import { it as check } from 'vite-plus/test'; check('raw', () => {});",
      "import {test as check} from 'playwright/test'; check('raw', () => {});",
      "import {test} from '@playwright/test'; test('raw', () => {});",
      "import raw from 'node:test'; raw('raw', () => {});",
      "import * as runner from 'node:test'; runner.test('raw', () => {});",
      "export * from 'vite-plus/test';",
      "const runner = await import('node:test');"
    ])
      expect(
        (await lintRule({ assert }, 'test-classification', { 'test/case.test.ts': source })).length
      ).toBeGreaterThan(0);
  }
);

test.unit.stable(
  'accepts canonical test namespace imports for each owning test area',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'test-classification',
      {
        'packages/sample/a.test.ts': `import {test} from '@study/testing'; test.unit.stable('case', () => {});`,
        'apps/client/src/a.test.ts': `import {test} from '@study/testing'; test.unit.stable('case', () => {});`,
        'apps/server/test/a.test.ts': `import {test} from '@study/testing'; test.unit.stable('case', () => {});`,
        'apps/client/src/locale.test.ts': `import {test} from '@study/testing'; test.unit.stable.extend('locale', 'italian')('case', () => {});`
      },
      true
    );

    expect(diagnostics).toStrictEqual([]);
  }
);

test.unit.stable(
  'requires environment namespace before classifications and rejects flat registrations',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;
    const diagnostics = await lintRule(
      { assert },
      'test-classification',
      {
        'packages/sample/unit.test.ts': `import {test} from '@study/testing'; test.unit.stable('case', () => {});`,
        'packages/sample/flat.test.ts': `import {test} from '@study/testing'; test.stable('case', () => {});`,
        'packages/sample/flat-hook.test.ts': `import {test} from '@study/testing'; test.describe('suite', () => {});`,
        'packages/sample/hooks.test.ts': `import {test} from '@study/testing'; test.unit.describe('suite', () => {}); test.server.beforeEach(() => {});`,
        'packages/sample/server.test.ts': `import {test} from '@study/testing'; test.server.regression({regression:'evidence_integrity'})('case', () => {});`,
        'packages/sample/browser.test.ts': `import {test} from '@study/testing'; test.browser.stable('case', () => {});`
      },
      true
    );

    expect(
      [...new Set(diagnostics.map(({ filename }) => filename.split('/').at(-1)))].sort()
    ).toEqual(['flat-hook.test.ts', 'flat.test.ts']);
  }
);

test.unit.stable(
  'allows test namespace references used only in TypeScript type queries',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'test-classification',
      {
        'apps/client/src/typed.test.tsx': `import { test } from '@study/testing';
        type Transport = ReturnType<typeof test.rpcHandlersTransport>;
        type UserEvent = ReturnType<typeof test.userEvent.setup>;
        type ScopedMock = test.Mock;
        let transport: Transport;
        let user: UserEvent;
        let mock: ScopedMock;
        test.unit.stable('typed helpers', () => { void [transport, user, mock]; });`,
        'apps/client/src/runtime-alias.test.ts': `import { test } from '@study/testing';
        const runner = test;
        runner.stable('runtime alias', () => {});`
      },
      true
    );

    expect([...new Set(diagnostics.map(({ filename }) => filename.split('/').at(-1)))]).toEqual([
      'runtime-alias.test.ts'
    ]);
  }
);

test.unit.stable(
  'permits private prepared test APIs only in the core conformance owner',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'test-classification',
      {
        'packages/testing/test/vitest.test.ts': `import { test, createTestApi } from '@study/testing/vitest';
        const prepared = createTestApi(test.unit.stable.extend({ fixture: async ({}, use) => use(1) }));
        prepared.stable('prepared runner', () => {});`,
        'packages/testing/test/other.test.ts': `import { test } from '@study/testing/vitest';
        test.unit.stable('private runner', () => {});`,
        'packages/testing/src/mock.ts': `import { vi } from 'vite-plus/test';
        export const register = vi.doMock;`
      },
      true
    );

    expect([...new Set(diagnostics.map(({ filename }) => filename.split('/').at(-1)))]).toEqual([
      'other.test.ts'
    ]);
  }
);

test.unit.stable(
  'permits private APIs only in the database scenario and setup owners',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'test-classification',
      {
        'packages/db/test/scenarios.ts': `import { createTestApi, test as baseTest } from '@study/testing/vitest';
        const runner = baseTest.unit.stable.extend('fixture', async ({}, use) => use(1));
        export const test = createTestApi(runner);`,
        'packages/db/test/setup.ts': `import { installTestApi } from '@study/testing/vitest';`,
        'packages/db/test/ordinary.test.ts': `import { test } from '@study/testing/vitest';
        test.unit.stable('private', () => {});`
      },
      true
    );

    expect([...new Set(diagnostics.map(({ filename }) => filename.split('/').at(-1)))]).toEqual([
      'ordinary.test.ts'
    ]);
  }
);

test.unit.stable(
  'rejects aliases, fake sources, legacy APIs and wrong application owners',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'test-classification',
      {
        'packages/sample/alias.test.ts': `import {test as check} from '@study/testing/vitest'; check.stable('case', () => {});`,
        'packages/sample/fake.test.ts': `import {test} from './fake.ts'; test.unit.stable('case', () => {});`,
        'packages/sample/fake-alias.test.ts': `import {test as check} from './fake.ts'; check.stable('case', () => {});`,
        'packages/sample/fake-namespace.test.ts': `import * as api from './fake.ts'; api.test.unit.stable('case', () => {});`,
        'packages/sample/old.test.ts': `import {testStable} from '@study/testing/vitest'; testStable('case', () => {});`,
        'apps/client/src/wrong-owner.test.ts': `import {test} from '@study/testing/vitest'; test.unit.stable('case', () => {});`,
        'apps/server/test/wrong-owner.test.ts': `import {test} from '@study/testing'; test.unit.stable('case', () => {});`,
        'packages/sample/namespace.test.ts': `import * as api from '@study/testing/vitest'; api.test.unit.stable('case', () => {});`,
        'packages/sample/helper-import.test.ts': `import {test, expect} from '@study/testing'; test.unit.stable('case', () => {});`,
        'packages/sample/helper-import.test.mts': `import {test, createAiMock} from '@study/testing'; test.unit.stable('case', () => {});`,
        'packages/sample/raw-assert.test.ts': `import {expect} from 'vite-plus/test'; expect(true).toBe(true);`,
        'packages/sample/reexport.ts': `export {test} from '@study/testing/vitest';`
      },
      true
    );

    expect(
      [...new Set(diagnostics.map(({ filename }) => filename.split('/').at(-1)))].sort()
    ).toEqual([
      'alias.test.ts',
      'fake-alias.test.ts',
      'fake-namespace.test.ts',
      'fake.test.ts',
      'helper-import.test.mts',
      'helper-import.test.ts',
      'namespace.test.ts',
      'old.test.ts',
      'raw-assert.test.ts',
      'reexport.ts',
      'wrong-owner.test.ts'
    ]);
  }
);

test.unit.stable(
  'prevents focus, skip, aliases, hidden wrappers and raw subtests',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'test-classification',
      {
        'packages/sample/a.test.ts': `import {test} from '@study/testing'; test.unit.stable.only('case', () => {});`,
        'packages/sample/b.test.ts': `import {test} from '@study/testing'; test.unit.stable('case', {skip:true}, () => {});`,
        'packages/sample/c.test.ts': `import {test} from '@study/testing'; const check = test.unit.stable;`,
        'packages/sample/d.test.ts': `import {test} from '@study/testing'; const wrapped = test.unit.stable.extend('custom', () => ({}));`,
        'packages/sample/e.test.ts': `import {test} from '@study/testing'; test.unit.stable('parent', t => { t.test('raw', () => {}); });`
      },
      true
    );

    expect(diagnostics.length).toBeGreaterThanOrEqual(4);
  }
);

test.unit.stable(
  'requires explicit metadata and meaningful removal conditions',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'test-classification',
      {
        'packages/sample/a.test.ts': `import {test} from '@study/testing'; test.unit.migration(metadata)('case', () => {});`,
        'packages/sample/b.test.ts': `import {test} from '@study/testing'; test.unit.regression({...metadata})('case', () => {});`,
        'packages/sample/c.test.ts': `import {test} from '@study/testing'; test.unit.migration({migration:'source_upgrade',retention:'temporary',removeWhen:'  '})('case', () => {});`,
        'packages/sample/d.test.ts': `import {test} from '@study/testing'; test.unit.regression({regression:'evidence_integrity'})('case', () => {});`
      },
      true
    );

    expect(diagnostics.map(({ filename }) => filename.split('/').at(-1)).sort()).toEqual([
      'a.test.ts',
      'b.test.ts',
      'c.test.ts'
    ]);
  }
);
