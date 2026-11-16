import { test } from '@study/testing';

import { lintRulePaths } from '../test/utils.ts';

test.stable(
  'module mocks come from lazy callback fixtures instead of the test namespace',
  async () => {
    const paths = await lintRulePaths('test-infrastructure', {
      'apps/client/src/static.test.ts': `import { test } from '@study/testing';
      test.mock('#client/lib/host.ts', () => ({}));`,
      'apps/client/src/computed.test.ts': `import { test } from '@study/testing';
      test['mock']('#client/lib/host.ts', () => ({}));`,
      'apps/client/src/hoisted.test.ts': `import { test } from '@study/testing';
      const state = test.hoisted(() => ({}));`,
      'apps/client/src/native.test.ts': `import { test } from '@study/testing';
      test.stable('module', () => test.vi.doMock('#client/lib/host.ts', () => ({})));`,
      'apps/client/src/alias.test.ts': `import { test } from '@study/testing';
      const moduleMock = test.vi.mock;
      moduleMock('#client/lib/host.ts', () => ({}));`,
      'apps/client/src/scoped.test.ts': `import { test } from '@study/testing';
      test.stable('module', async ({ mock }) => {
        mock('#client/lib/host.ts', () => ({}));
        const host = await import('#client/lib/host.ts');
        test.expect(host).toBeDefined();
      });`
    });

    test
      .expect([...new Set(paths)].sort())
      .toEqual([
        'apps/client/src/alias.test.ts',
        'apps/client/src/computed.test.ts',
        'apps/client/src/hoisted.test.ts',
        'apps/client/src/native.test.ts',
        'apps/client/src/static.test.ts'
      ]);
  }
);

test.stable(
  'callback module mocks require a dynamic subject import but ignore type-only imports and mock functions',
  async () => {
    const paths = await lintRulePaths('test-infrastructure', {
      'apps/client/src/static-subject.test.ts': `import { test } from '@study/testing';
      import { useHost } from '#client/lib/host.ts';
      test.stable('mocked subject', async ({ mock }) => {
        mock('#client/lib/host.ts', () => ({ useHost: () => null }));
        await import('#client/lib/host.ts');
        void useHost;
      });`,
      'apps/client/src/aliased-static-subject.test.ts': `import { test } from '@study/testing';
      import { useHost } from '#client/lib/host.ts';
      test.stable('aliased mock fixture', async ({ mock: register }) => {
        register('#client/lib/host.ts', () => ({ useHost: () => null }));
        void useHost;
      });`,
      'apps/client/src/side-effect-static-subject.test.ts': `import { test } from '@study/testing';
      import '#client/lib/host.ts';
      test.beforeEach(({ mock }) => mock('#client/lib/host.ts', () => ({})));`,
      'apps/client/src/for-static-subject.test.ts': `import { test } from '@study/testing';
      import { useHost } from '#client/lib/host.ts';
      test.stable.for([1])('mock fixture after case args', async (_value, { mock }) => {
        const register = mock;
        register('#client/lib/host.ts', () => ({ useHost: () => null }));
        void useHost;
      });`,
      'apps/client/src/type-only-subject.test.ts': `import { test } from '@study/testing';
      import type { Host } from '#client/lib/host.ts';
      test.stable('typed subject', async ({ mock }) => {
        const register = mock;
        register('#client/lib/host.ts', () => ({}));
        let host: Host | undefined;
        void host;
      });`,
      'apps/client/src/ordinary-mock-function.test.ts': `import { test } from '@study/testing';
      test.stable('ordinary mock function', async () => {
        const mock = test.vi.fn();
        mock('#client/lib/host.ts');
      });`
    });

    test
      .expect(paths)
      .toEqual([
        'apps/client/src/aliased-static-subject.test.ts',
        'apps/client/src/for-static-subject.test.ts',
        'apps/client/src/side-effect-static-subject.test.ts',
        'apps/client/src/static-subject.test.ts'
      ]);
  }
);

test.stable('application source cannot import test-only public facets', async () => {
  const paths = await lintRulePaths('test-infrastructure', {
    'apps/client/src/lib/bad.ts':
      "import { rpcValuesTransport } from '@study/contracts/react/testing';",
    'apps/server/src/runtime/bad.ts':
      "import { createServerFixture } from '@study/server/testing';",
    'packages/contracts/src/bad.ts': "export * from '@study/contracts/testing';",
    'apps/client/src/test/good.ts':
      "import { rpcValuesTransport } from '@study/contracts/react/testing';",
    'apps/client/src/render.test.ts': "import { renderPage } from '#client/test/render-page.tsx';",
    'apps/server/src/features/notes/service/good.test.ts':
      "import { createServerFixture } from '@study/server/testing';"
  });

  test
    .expect([...new Set(paths)].sort())
    .toEqual([
      'apps/client/src/lib/bad.ts',
      'apps/client/src/render.test.ts',
      'apps/server/src/features/notes/service/good.test.ts',
      'apps/server/src/runtime/bad.ts',
      'packages/contracts/src/bad.ts'
    ]);
});

test.stable(
  'integration runner tests remain subject to shared resource ownership rules',
  async () => {
    const paths = await lintRulePaths('test-infrastructure', {
      'tooling/testing/integrations/runner.test.ts': `import { test } from '@study/testing';
      test.stable('process cleanup', async () => { Bun.spawn(['bun', 'server.ts']); });`
    });

    test.expect(paths).toEqual(['tooling/testing/integrations/runner.test.ts']);
  }
);

test.stable('application tests cannot construct database or server fixtures directly', async () => {
  const paths = await lintRulePaths('test-infrastructure', {
    'packages/db/test/bad.test.ts': `import { createTestDatabase } from '@study/db/testing';
      import { test } from '@study/testing';
      test.stable('database', async () => { const fixture = await createTestDatabase(); });`,
    'apps/server/test/bad.test.ts': `import { createServerFixture } from '@study/server/testing';
      import { test } from '@study/testing';
      test.stable('RPC', async () => { await using fixture = await createServerFixture(); });`,
    'apps/server/test/testing/owned.ts': `import { createServerFixture } from '@study/server/testing';
      export const fixture = () => createServerFixture();`,
    'apps/client/src/bad.test.ts': `import { Db } from '@study/db';
      import { test } from '@study/testing';
      test.stable('database', async () => { await Db.open(':memory:'); });`,
    'apps/server/test/server-open.test.ts': `import { App } from '@study/server/testing';
      import { test } from '@study/testing';
      test.stable('server', async () => { await App.open(); });`,
    'apps/server/test/server-test.test.ts': `import { createServerTest } from '#testing/server-test';
      import { test } from '@study/testing';
      test.stable('server', async () => { await createServerTest(); });`
  });

  test
    .expect([...new Set(paths)])
    .toEqual([
      'apps/client/src/bad.test.ts',
      'apps/server/test/bad.test.ts',
      'apps/server/test/server-open.test.ts',
      'apps/server/test/server-test.test.ts',
      'packages/db/test/bad.test.ts'
    ]);
});

test.stable(
  'ordinary tests use the public facade instead of low-level testing facets',
  async () => {
    const paths = await lintRulePaths('test-infrastructure', {
      'apps/client/src/ui.test.tsx': `import { render } from '@testing-library/react';`,
      'apps/client/src/protocol.test.ts': `import { rpcValuesTransport } from '@study/contracts/react/testing';`,
      'apps/server/test/service.test.ts': `import { createServerFixture } from '@study/server/testing';`,
      'packages/db/test/paths.test.ts': `import { temporaryDirectory } from '@study/testing/resources';`,
      'apps/server/test/types.test.ts': `import type { ServerTestContext } from '@study/server/testing';`,
      'apps/client/src/test/scenarios.tsx': `import { render } from '@testing-library/react';`,
      'apps/server/test/testing/scenarios.ts': `import { createTestDatabase } from '@study/db/testing';`,
      'apps/client/src/features/material-library/test/support.tsx': `import { render } from '@testing-library/react';
      import { rpcHandlersTransport } from '@study/contracts/react/testing';`,
      'apps/server/test/testing/page-transform.ts': `import { createTestResources } from '@study/testing/resources';`,
      'apps/client/src/test/assistant.tsx': `import { render } from '@testing-library/react';`
    });

    test
      .expect([...new Set(paths)].sort())
      .toEqual([
        'apps/client/src/protocol.test.ts',
        'apps/client/src/ui.test.tsx',
        'apps/server/test/service.test.ts',
        'packages/db/test/paths.test.ts'
      ]);
  }
);

test.stable(
  'fixture subject tests may import the primitives they are specifically testing',
  async () => {
    const paths = await lintRulePaths('test-infrastructure', {
      'packages/db/test/testing.test.ts': `import { test } from '@study/testing';
      import { createTestDatabase } from '@study/db/testing';
      test.stable('fixture disposal', async () => { await using fixture = await test.createTestDatabase(); });`,
      'packages/testing/test/resources.test.ts': `import { temporaryDirectory } from '@study/testing/resources';`,
      'packages/testing/test/process.test.ts': `import { spawnScopedProcess } from '@study/testing/process';`,
      'packages/testing/test/ordinary.test.ts': `import { temporaryDirectory } from '@study/testing/resources';`
    });

    test.expect(paths).toEqual(['packages/testing/test/ordinary.test.ts']);
  }
);

test.stable('public namespace cannot expose fixture constructors to ordinary tests', async () => {
  const paths = await lintRulePaths('test-infrastructure', {
    'apps/server/test/direct.test.ts': `import { test } from '@study/testing';
      test.stable('database', async () => { await test.createTestDatabase(); });
      test.stable('server', async () => { await test.createServerFixture(); });`,
    'apps/server/test/testing/scenarios.ts': `import { test } from '@study/testing';
      test.createServerFixture();`
  });

  test.expect([...new Set(paths)]).toEqual(['apps/server/test/direct.test.ts']);
});

test.stable('canonical application callbacks are direct test registrations', async () => {
  const paths = await lintRulePaths('test-infrastructure', {
    'apps/client/src/valid.test.ts': `import {test} from '#client/test/scenarios.tsx';
test.stable('reader', async ({react}) => { await react.render(<div />); });`,
    'apps/server/test/valid.test.ts': `import {test} from '#testing/scenarios';
test.stable('service', async ({server}) => { await server.run(); });`,
    'apps/client/src/hidden.test.ts': `import {test} from '#client/test/scenarios.tsx';
function wrap(fn) { return test.stable('reader', fn); }`
  });

  test.expect(paths).toEqual(['apps/client/src/valid.test.ts']);
});

test.stable(
  'fixture directories and sleep loops use the canonical resource and observation helpers',
  async () => {
    const paths = await lintRulePaths('test-infrastructure', {
      'apps/client/test/e2e/harness/custom.ts': `import { FileSystem } from 'effect';
      function* fixture() { const fs = yield* FileSystem.FileSystem;
      yield* fs.makeTempDirectory({ prefix: 'local-' }); }`,
      'apps/server/src/features/notes/service/custom.test.ts': `import { Effect as E } from 'effect';
      function* work() { while (!ready) { yield* E.sleep('50 millis'); } }`,
      'apps/server/test/alias.test.ts': `import * as runtime from 'effect';
      const pause = runtime.Effect.sleep;
      function* work() { for (;;) { yield* pause('50 millis'); } }`,
      'apps/server/test/clock.test.ts': `import { Effect } from 'effect';
      const task = Effect.sleep('1 second');`,
      'apps/client/test/good.test.ts': `import { temporaryDirectory } from '@study/testing/resources';
      await using directory = await temporaryDirectory();`,
      'apps/server/test/shadow.test.ts': `function check(Effect: any) {
      while (!ready) Effect.sleep('50 millis');
    }`
    });

    test
      .expect([...new Set(paths)])
      .toEqual([
        'apps/client/test/good.test.ts',
        'apps/server/src/features/notes/service/custom.test.ts',
        'apps/server/test/alias.test.ts'
      ]);
  }
);

test.stable(
  'tests use shared resource lifetimes and native polling instead of local machinery',
  async () => {
    const paths = await lintRulePaths('test-infrastructure', {
      'apps/server/test/process.test.ts': "Bun.spawn(['bun', 'server.ts']);",
      'apps/server/test/alias.test.ts':
        "import { spawn as launch } from 'bun'; launch(['bun', 'server.ts']);",
      'apps/server/test/constant.test.ts':
        "const runtime = Bun; const launch = runtime['spawnSync']; launch(['bun']);",
      'apps/server/test/namespace.test.ts':
        "import * as runtime from 'bun'; runtime.spawn(['bun']);",
      'apps/server/test/imported-constant.test.ts':
        "import { spawn } from 'bun'; const launch = spawn; launch(['bun']);",
      'apps/server/test/testing/custom.ts': "Bun.spawn(['bun']);",
      'apps/server/test/poll.test.ts': 'await Bun.sleep(50);',
      'apps/server/test/temp.test.ts': "import { $ } from 'bun'; await $`mktemp -d`;",
      'apps/server/test/good.test.ts': `import { test } from '@study/testing';
test.spawnTestProcess(['bun', 'server.ts']);
await test.waitFor(() => true);`,
      'apps/server/test/shadow.test.ts': "function check(Bun: any) { Bun.spawn(['fixture']); }",
      'tooling/testing/runner.ts': "Bun.spawn(['bun', 'runner.ts']);"
    });

    test
      .expect([...new Set(paths)])
      .toEqual([
        'apps/server/test/alias.test.ts',
        'apps/server/test/constant.test.ts',
        'apps/server/test/imported-constant.test.ts',
        'apps/server/test/namespace.test.ts',
        'apps/server/test/poll.test.ts',
        'apps/server/test/process.test.ts',
        'apps/server/test/temp.test.ts'
      ]);
  }
);

test.stable(
  'runner construction and configuration belong to the shared testing owners',
  async () => {
    const paths = await lintRulePaths('test-infrastructure', {
      'apps/client/src/custom.test.ts':
        "import { configure as setup } from '@testing-library/react'; setup({asyncUtilTimeout: 9000});",
      'apps/client/src/runner.ts':
        "import { createVitest } from 'vite-plus/test/node'; createVitest('test', {});",
      'apps/client/src/policy.test.ts':
        "import { vi as runner } from 'vite-plus/test'; runner.setConfig({retry: 3});",
      'apps/client/src/registration.test.ts': `import { test } from '@study/testing';
 export function check(name: string, fn: any) { test.stable(name, fn);
 }`,
      'apps/client/src/test/setup.ts': `import * as testing from '@testing-library/react';
 const setup = testing.configure;
 setup({asyncUtilTimeout: 1});
`,
      'apps/client/src/arrow.ts': `import { test } from '@study/testing';
 export const check = (fn: any) => test.stable('wrapped', fn);
`,
      'apps/client/src/function.ts': `import { test } from '@study/testing';
 export const check = function(fn: any) { test.stable('wrapped', fn);
 };
`,
      'apps/client/src/good.test.ts':
        "import { test } from '@study/testing'; test.stable('renders', () => {});",
      'packages/testing/src/react/setup.ts':
        "import { configure } from '@testing-library/react'; configure({asyncUtilTimeout: 5000});",
      'tooling/testing/runner.ts':
        "import { createVitest } from 'vite-plus/test/node'; createVitest('test', {});"
    });

    test
      .expect([...new Set(paths)])
      .toEqual([
        'apps/client/src/arrow.ts',
        'apps/client/src/custom.test.ts',
        'apps/client/src/function.ts',
        'apps/client/src/policy.test.ts',
        'apps/client/src/registration.test.ts',
        'apps/client/src/runner.ts'
      ]);
  }
);
