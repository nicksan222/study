import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('reports the prohibited pattern', async () => {
  const diagnostics = await lintRule(
    'no-double-assertion',
    { 'src/domain.ts': 'const value = input as unknown as string;' },
    false
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('allows single assertions and skips tests while catching angle assertions', async () => {
  const diagnostics = await lintRule('no-double-assertion', {
    'src/a.ts':
      'const a = <string><any>value; const b = value as string; const c = value as const;',
    'src/a.test.ts': 'const a = value as unknown as string;'
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});
