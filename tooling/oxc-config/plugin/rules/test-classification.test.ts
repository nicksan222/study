import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable(
  'rejects raw runner imports including aliases, namespaces and default imports',
  async () => {
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
      test
        .expect((await lintRule('test-classification', { 'test/case.test.ts': source })).length)
        .toBeGreaterThan(0);
  }
);

test.stable('accepts canonical test namespace imports for each owning test area', async () => {
  const diagnostics = await lintRule(
    'test-classification',
    {
      'packages/sample/a.test.ts': `import {test} from '@study/testing'; test.stable('case', () => {});`,
      'apps/client/src/a.test.ts': `import {test} from '@study/testing'; test.stable('case', () => {});`,
      'apps/server/test/a.test.ts': `import {test} from '@study/testing'; test.stable('case', () => {});`,
      'apps/client/src/locale.test.ts': `import {test} from '@study/testing'; test.stable.extend('locale', 'italian')('case', () => {});`
    },
    true
  );

  test.expect(diagnostics).toStrictEqual([]);
});

test.stable('allows test namespace references used only in TypeScript type queries', async () => {
  const diagnostics = await lintRule(
    'test-classification',
    {
      'apps/client/src/typed.test.tsx': `import { test } from '@study/testing';
        type Transport = ReturnType<typeof test.rpcHandlersTransport>;
        type UserEvent = ReturnType<typeof test.userEvent.setup>;
        type ScopedMock = test.Mock;
        let transport: Transport;
        let user: UserEvent;
        let mock: ScopedMock;
        test.stable('typed helpers', () => { void [transport, user, mock]; });`,
      'apps/client/src/runtime-alias.test.ts': `import { test } from '@study/testing';
        const runner = test;
        runner.stable('runtime alias', () => {});`
    },
    true
  );

  test
    .expect([...new Set(diagnostics.map(({ filename }) => filename.split('/').at(-1)))])
    .toEqual(['runtime-alias.test.ts']);
});

test.stable('permits private prepared test APIs only in the core conformance owner', async () => {
  const diagnostics = await lintRule(
    'test-classification',
    {
      'packages/testing/test/vitest.test.ts': `import { test, createTestApi } from '@study/testing/vitest';
        const prepared = createTestApi(test.stable.extend({ fixture: async ({}, use) => use(1) }));
        prepared.stable('prepared runner', () => {});`,
      'packages/testing/test/other.test.ts': `import { test } from '@study/testing/vitest';
        test.stable('private runner', () => {});`,
      'packages/testing/src/mock.ts': `import { vi } from 'vite-plus/test';
        export const register = vi.doMock;`
    },
    true
  );

  test
    .expect([...new Set(diagnostics.map(({ filename }) => filename.split('/').at(-1)))])
    .toEqual(['other.test.ts']);
});

test.stable('permits private APIs only in the database scenario and setup owners', async () => {
  const diagnostics = await lintRule(
    'test-classification',
    {
      'packages/db/test/scenarios.ts': `import { createTestApi, test as baseTest } from '@study/testing/vitest';
        const runner = baseTest.stable.extend('fixture', async ({}, use) => use(1));
        export const test = createTestApi(runner);`,
      'packages/db/test/setup.ts': `import { installTestApi } from '@study/testing/vitest';`,
      'packages/db/test/ordinary.test.ts': `import { test } from '@study/testing/vitest';
        test.stable('private', () => {});`
    },
    true
  );

  test
    .expect([...new Set(diagnostics.map(({ filename }) => filename.split('/').at(-1)))])
    .toEqual(['ordinary.test.ts']);
});

test.stable('rejects aliases, fake sources, legacy APIs and wrong application owners', async () => {
  const diagnostics = await lintRule(
    'test-classification',
    {
      'packages/sample/alias.test.ts': `import {test as check} from '@study/testing/vitest'; check.stable('case', () => {});`,
      'packages/sample/fake.test.ts': `import {test} from './fake.ts'; test.stable('case', () => {});`,
      'packages/sample/fake-alias.test.ts': `import {test as check} from './fake.ts'; check.stable('case', () => {});`,
      'packages/sample/fake-namespace.test.ts': `import * as api from './fake.ts'; api.test.stable('case', () => {});`,
      'packages/sample/old.test.ts': `import {testStable} from '@study/testing/vitest'; testStable('case', () => {});`,
      'apps/client/src/wrong-owner.test.ts': `import {test} from '@study/testing/vitest'; test.stable('case', () => {});`,
      'apps/server/test/wrong-owner.test.ts': `import {test} from '@study/testing'; test.stable('case', () => {});`,
      'packages/sample/namespace.test.ts': `import * as api from '@study/testing/vitest'; api.test.stable('case', () => {});`,
      'packages/sample/helper-import.test.ts': `import {test, expect} from '@study/testing'; test.stable('case', () => {});`,
      'packages/sample/helper-import.test.mts': `import {test, createAiMock} from '@study/testing'; test.stable('case', () => {});`,
      'packages/sample/raw-assert.test.ts': `import {expect} from 'vite-plus/test'; expect(true).toBe(true);`,
      'packages/sample/reexport.ts': `export {test} from '@study/testing/vitest';`
    },
    true
  );

  test
    .expect([...new Set(diagnostics.map(({ filename }) => filename.split('/').at(-1)))].sort())
    .toEqual([
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
});

test.stable('prevents focus, skip, aliases, hidden wrappers and raw subtests', async () => {
  const diagnostics = await lintRule(
    'test-classification',
    {
      'packages/sample/a.test.ts': `import {test} from '@study/testing'; test.stable.only('case', () => {});`,
      'packages/sample/b.test.ts': `import {test} from '@study/testing'; test.stable('case', {skip:true}, () => {});`,
      'packages/sample/c.test.ts': `import {test} from '@study/testing'; const check = test.stable;`,
      'packages/sample/d.test.ts': `import {test} from '@study/testing'; const wrapped = test.stable.extend('custom', () => ({}));`,
      'packages/sample/e.test.ts': `import {test} from '@study/testing'; test.stable('parent', t => { t.test('raw', () => {}); });`
    },
    true
  );

  test.expect(diagnostics.length).toBeGreaterThanOrEqual(4);
});

test.stable('requires explicit metadata and meaningful removal conditions', async () => {
  const diagnostics = await lintRule(
    'test-classification',
    {
      'packages/sample/a.test.ts': `import {test} from '@study/testing'; test.migration(metadata)('case', () => {});`,
      'packages/sample/b.test.ts': `import {test} from '@study/testing'; test.regression({...metadata})('case', () => {});`,
      'packages/sample/c.test.ts': `import {test} from '@study/testing'; test.migration({migration:'source_upgrade',retention:'temporary',removeWhen:'  '})('case', () => {});`,
      'packages/sample/d.test.ts': `import {test} from '@study/testing'; test.regression({regression:'evidence_integrity'})('case', () => {});`
    },
    true
  );

  test
    .expect(diagnostics.map(({ filename }) => filename.split('/').at(-1)).sort())
    .toEqual(['a.test.ts', 'b.test.ts', 'c.test.ts']);
});
