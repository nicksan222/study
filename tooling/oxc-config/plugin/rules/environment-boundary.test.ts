import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('reports the prohibited pattern', () => {
  const diagnostics = lintRule(
    'environment-boundary',
    { 'src/domain.ts': 'const key = process.env.KEY;' },
    false
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('recognizes aliases and destructuring without confusing shadowed process', () => {
  const diagnostics = lintRule('environment-boundary', {
    'src/a.ts':
      "const p = process; const { env } = p; const value = p['env'].KEY; function f(process: any) { return process.env.KEY; }",
    'src/runtime/config.ts': 'const value = process.env.KEY;',
    'src/a.test.ts': 'const value = process.env.KEY;'
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('traces process imports, global aliases and nested destructuring at startup boundaries', () => {
  const diagnostics = lintRule('environment-boundary', {
    'src/a.ts':
      "import proc, { env as vars } from 'node:process'; const p = globalThis.process; const { env: { KEY } } = p; const x = proc.env.KEY; const y = vars.KEY; function f(globalThis: any) { return globalThis.process.env.X; }",
    'src/main.ts': 'const x = process.env.X;',
    'src/runtime/main.ts': 'const x = process.env.X;'
  });

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});
