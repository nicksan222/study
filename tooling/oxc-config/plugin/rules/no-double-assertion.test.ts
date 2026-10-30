import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('reports the prohibited pattern', () => {
  const diagnostics = lintRule(
    'no-double-assertion',
    { 'src/domain.ts': 'const value = input as unknown as string;' },
    false
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('allows single assertions and skips tests while catching angle assertions', () => {
  const diagnostics = lintRule('no-double-assertion', {
    'src/a.ts':
      'const a = <string><any>value; const b = value as string; const c = value as const;',
    'src/a.test.ts': 'const a = value as unknown as string;'
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});
