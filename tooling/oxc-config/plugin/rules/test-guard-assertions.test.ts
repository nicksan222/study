import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('reports direct test guards but not nested callbacks or production', async () => {
  const diagnostics = await lintRule('test-guard-assertions', {
    'src/a.test.ts': `import { testStable as check } from '@study/testing/vitest'; check('x', () => { if (!x) return; if (!y) { throw new Error('missing'); } [1].map(() => { return; }); });`,
    'src/a.ts': `if (!x) { throw new Error('missing'); }`
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('reports unbraced throws and permits a final return', async () => {
  const diagnostics = await lintRule('test-guard-assertions', {
    'src/a.test.ts':
      "import { testStable } from '@study/testing/vitest'; testStable('x', () => { if (!x) throw new Error('missing'); return; });"
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable(
  'tracks namespace and constant aliases while respecting shadowed Error and test bindings',
  async () => {
    const diagnostics = await lintRule('test-guard-assertions', {
      'src/aliases.test.ts': `import * as runner from 'vite-plus/test'; import {testStable} from '@study/testing/vitest';
      const check = testStable;
      check('alias', () => { if (!value) throw new Error('missing'); });
      runner.test.each([1])('namespace', () => { if (!value) return; });
      function helper(testStable) { testStable('local', () => { if (!value) return; }); }
      testStable('shadowed Error', () => { class Error {} if (!value) throw new Error(); });`
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable('preserves deliberate callback failures, helpers, and non-guard branches', async () => {
  const diagnostics = await lintRule('test-guard-assertions', {
    'src/callbacks.test.ts': `import {testStable} from '@study/testing/vitest';
      testStable('rollback', () => { transaction(() => { throw new Error('rollback'); }); });
      testStable('helper', () => { function helper() { if (!value) return; } helper(); });
      testStable('branch', () => { if (mode) { record(); throw new Error('injected'); } });
      testStable('done', () => { return; });`
  });

  assert.strictEqual(diagnostics.length, 0, JSON.stringify(diagnostics));
});
