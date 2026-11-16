import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable('requires assertions instead of return guards in test callbacks', async () => {
  const diagnostics = await lintRule('test-guard-assertions', {
    'src/a.test.ts': `import { test } from '@study/testing';
 const check = test.stable;
 check('x', () => { if (!x) return;
 if (!y) { throw new Error('missing');
 } [1].map(() => { return;
 });
 });
`,
    'src/a.ts': `if (!x) { throw new Error('missing'); }`
  });

  test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test.stable('rejects unbraced guard throws while allowing a final callback return', async () => {
  const diagnostics = await lintRule('test-guard-assertions', {
    'src/a.test.ts': `import { test } from '@study/testing';
 test.stable('x', () => { if (!x) throw new Error('missing');
 return;
 });
`
  });

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test.stable(
  'tracks namespace and constant aliases while respecting shadowed Error and test bindings',
  async () => {
    const diagnostics = await lintRule('test-guard-assertions', {
      'src/aliases.test.ts': `import * as runner from 'vite-plus/test'; import { test } from '@study/testing';
      const check = test.stable;
      check('alias', () => { if (!value) throw new Error('missing'); });
      runner.test.each([1])('namespace', () => { if (!value) return; });
      function helper(test) { test.stable('local', () => { if (!value) return; }); }
      test.stable('shadowed Error', () => { class Error {} if (!value) throw new Error(); });`
    });

    test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable('preserves deliberate callback failures, helpers, and non-guard branches', async () => {
  const diagnostics = await lintRule('test-guard-assertions', {
    'src/callbacks.test.ts': `import { test } from '@study/testing';
      test.stable('rollback', () => { transaction(() => { throw new Error('rollback'); }); });
      test.stable('helper', () => { function helper() { if (!value) return; } helper(); });
      test.stable('branch', () => { if (mode) { record(); throw new Error('injected'); } });
      test.stable('done', () => { return; });`
  });

  test.assert.strictEqual(diagnostics.length, 0, JSON.stringify(diagnostics));
});

test.stable('preserves browser journey layout failure guards', async () => {
  const diagnostics = await lintRule('test-guard-assertions', {
    'apps/client/test/e2e/empty-note.test.ts': `import { test } from '@study/testing';
      test.stable('empty note', () => { if (!top) throw new Error('Saved note has no layout box'); });`
  });

  test.expect(diagnostics).toHaveLength(0);
});
