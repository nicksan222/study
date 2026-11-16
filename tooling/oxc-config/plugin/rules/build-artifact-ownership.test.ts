import { test } from '@study/testing';

import { lintRulePaths } from '../test/utils.ts';

test.stable(
  'disposable runners disable disk transforms and contract fixtures own temporary paths',
  async () => {
    const paths = await lintRulePaths('build-artifact-ownership', {
      'apps/client/test/e2e/harness/good.test.ts': `
      import { createVitest as runner } from 'vite-plus/test/node';
      const options = { fsModuleCache: false }; runner('test', options);
      const directory = await temporaryArtifacts();
      new Bun.Glob(\`test-results/workers/\${process.pid}-*.json\`);
    `,
      'apps/client/test/e2e/harness/cache.test.ts': `
      import { createVitest as runner } from 'vite-plus/test/node'; runner('test', {config:false});
    `,
      'apps/client/test/e2e/harness/spread.test.ts': `
      import * as vitest from 'vite-plus/test/node'; vitest.createVitest('test', {fsModuleCache:false, ...options});
    `,
      'apps/client/test/e2e/harness/leak.test.ts':
        'const directory = `test-results/contracts/${crypto.randomUUID()}`;',
      'apps/client/test/e2e/harness/fixed.test.ts': "const directory = 'test-results/focus';"
    });

    test
      .expect(paths)
      .toEqual([
        'apps/client/test/e2e/harness/cache.test.ts',
        'apps/client/test/e2e/harness/fixed.test.ts',
        'apps/client/test/e2e/harness/leak.test.ts',
        'apps/client/test/e2e/harness/spread.test.ts'
      ]);
  }
);

test.stable('computed runner options cannot hide a later cache override', async () => {
  const header = "import { createVitest } from 'vite-plus/test/node';";
  const paths = await lintRulePaths('build-artifact-ownership', {
    'apps/client/test/e2e/harness/known.test.ts': `${header} const key = 'fsModuleCache'; createVitest('test', {fsModuleCache:false, [key]:true});`,
    'apps/client/test/e2e/harness/unknown.test.ts': `${header} createVitest('test', {fsModuleCache:false, [key]:true});`,
    'apps/client/test/e2e/harness/good.test.ts': `${header} const key = 'fsModuleCache'; createVitest('test', {[key]:false});`,
    'apps/client/test/e2e/harness/earlier.test.ts': `${header} createVitest('test', {[key]:true, fsModuleCache:false});`
  });

  test
    .expect(paths)
    .toEqual([
      'apps/client/test/e2e/harness/known.test.ts',
      'apps/client/test/e2e/harness/unknown.test.ts'
    ]);
});
