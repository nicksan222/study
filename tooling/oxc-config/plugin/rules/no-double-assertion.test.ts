import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable('rejects chained type assertions that bypass type checking', async () => {
  const diagnostics = await lintRule(
    'no-double-assertion',
    { 'src/domain.ts': 'const value = input as unknown as string;' },
    false
  );

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test.stable(
  'allows single assertions and skips tests while catching angle assertions',
  async () => {
    const diagnostics = await lintRule('no-double-assertion', {
      'src/a.ts':
        'const a = <string><any>value; const b = value as string; const c = value as const;',
      'src/a.test.ts': 'const a = value as unknown as string;'
    });

    test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);
