import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('no-lossy-ids guards production and accepts safe alternatives', () => {
  const diagnostics = lintRule('no-lossy-ids', {
    'src/bad.ts': 'Number(item.id); parseInt(projectId, 10);',
    'src/good.ts': 'Number(count); Number(durationMs); function f(Number) { Number(item.id); }',
    'src/fixture.test.ts': 'Number(item.id); parseInt(projectId, 10);'
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('no-lossy-ids handles aliases and avoids unrelated bindings', () => {
  const diagnostics = lintRule('no-lossy-ids', {
    'src/bad.ts': 'Number(item["id"]); parseFloat(source_id);',
    'src/good.ts': 'function f(JSON) { return JSON.parse(row.body) as Body; } Number(pageCount);'
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('no-lossy-ids covers direct unsafe forms', () => {
  const diagnostics = lintRule('no-lossy-ids', {
    'src/bad.ts': 'Number.parseInt(row.id, 10);',
    'src/good.ts': 'Number.parseInt(row.duration, 10);'
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});
