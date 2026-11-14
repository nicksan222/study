import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRulePaths } from '../test/utils.ts';

testStable(
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

    expect(paths).toEqual([
      'apps/client/test/e2e/harness/cache.test.ts',
      'apps/client/test/e2e/harness/fixed.test.ts',
      'apps/client/test/e2e/harness/leak.test.ts',
      'apps/client/test/e2e/harness/spread.test.ts'
    ]);
  }
);
