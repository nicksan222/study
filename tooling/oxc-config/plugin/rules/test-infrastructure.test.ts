import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRulePaths } from '../test/utils.ts';

testStable(
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
      'apps/server/test/good.test.ts':
        "import { spawnTestProcess } from '@study/testing/vitest'; import { waitFor } from '@study/testing/vitest'; spawnTestProcess(['bun', 'server.ts']); await waitFor(() => true);",
      'apps/server/test/shadow.test.ts': "function check(Bun: any) { Bun.spawn(['fixture']); }",
      'tooling/testing/runner.ts': "Bun.spawn(['bun', 'runner.ts']);"
    });

    expect(paths).toEqual([
      'apps/server/test/alias.test.ts',
      'apps/server/test/constant.test.ts',
      'apps/server/test/imported-constant.test.ts',
      'apps/server/test/namespace.test.ts',
      'apps/server/test/poll.test.ts',
      'apps/server/test/process.test.ts',
      'apps/server/test/temp.test.ts',
      'apps/server/test/testing/custom.ts'
    ]);
  }
);

testStable(
  'runner construction and configuration belong to the shared testing owners',
  async () => {
    const paths = await lintRulePaths('test-infrastructure', {
      'apps/client/src/custom.test.ts':
        "import { configure as setup } from '@testing-library/react'; setup({asyncUtilTimeout: 9000});",
      'apps/client/src/runner.ts':
        "import { createVitest } from 'vite-plus/test/node'; createVitest('test', {});",
      'apps/client/src/policy.test.ts':
        "import { vi as runner } from 'vite-plus/test'; runner.setConfig({retry: 3});",
      'apps/client/src/registration.test.ts':
        "import { testStable } from '@study/testing/vitest'; export function check(name: string, fn: any) { testStable(name, fn); }",
      'apps/client/src/test/setup.ts':
        "import * as testing from '@testing-library/react'; const setup = testing.configure; setup({asyncUtilTimeout: 1});",
      'apps/client/src/arrow.ts':
        "import { testStable } from '@study/testing/vitest'; export const check = (fn: any) => testStable('wrapped', fn);",
      'apps/client/src/function.ts':
        "import { testStable } from '@study/testing/vitest'; export const check = function(fn: any) { testStable('wrapped', fn); };",
      'apps/client/src/good.test.ts':
        "import { testStable } from '@study/testing/vitest'; testStable('renders', () => {});",
      'packages/testing/src/react/setup.ts':
        "import { configure } from '@testing-library/react'; configure({asyncUtilTimeout: 5000});",
      'tooling/testing/runner.ts':
        "import { createVitest } from 'vite-plus/test/node'; createVitest('test', {});"
    });

    expect(paths).toEqual([
      'apps/client/src/arrow.ts',
      'apps/client/src/custom.test.ts',
      'apps/client/src/function.ts',
      'apps/client/src/policy.test.ts',
      'apps/client/src/registration.test.ts',
      'apps/client/src/runner.ts',
      'apps/client/src/test/setup.ts'
    ]);
  }
);
