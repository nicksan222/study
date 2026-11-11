import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('rejects builtin imports, exports and loads including bare names', async () => {
  const diagnostics = await lintRule('no-node-builtins', {
    'src/bad.ts': `import 'node:fs'; export * from 'path'; const a = import('node:crypto'); const b = require('fs/promises');`,
    'src/good.ts': `import { Effect } from 'effect'; const text = "import 'node:fs'";`
  });

  expect(diagnostics).toHaveLength(4);
});
