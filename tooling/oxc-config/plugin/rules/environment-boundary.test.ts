import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('reports the prohibited pattern', async () => {
  const diagnostics = await lintRule(
    'environment-boundary',
    { 'src/domain.ts': 'const key = process.env.KEY;' },
    false
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('recognizes aliases and destructuring without confusing shadowed process', async () => {
  const diagnostics = await lintRule('environment-boundary', {
    'src/a.ts':
      "const p = process; const { env } = p; const value = p['env'].KEY; function f(process: any) { return process.env.KEY; }",
    'src/runtime/config.ts': 'const value = process.env.KEY;',
    'src/a.test.ts': 'const value = process.env.KEY;'
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable(
  'traces process imports, global aliases and nested destructuring at startup boundaries',
  async () => {
    const diagnostics = await lintRule('environment-boundary', {
      'src/a.ts':
        "import proc, { env as vars } from 'node:process'; const p = globalThis.process; const { env: { KEY } } = p; const x = proc.env.KEY; const y = vars.KEY; function f(globalThis: any) { return globalThis.process.env.X; }",
      'src/main.ts': 'const x = process.env.X;',
      'src/runtime/main.ts': 'const x = process.env.X;'
    });

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);
