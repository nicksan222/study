import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('rejects raw runner imports including aliases, namespaces and default imports', () => {
  for (const source of [
    "import { test } from 'node:test'; test('raw', () => {});",
    "import { it as check } from 'vite-plus/test'; check('raw', () => {});",
    "import raw from 'node:test'; raw('raw', () => {});",
    "import * as runner from 'node:test'; runner.test('raw', () => {});",
    "export { test as testStable } from 'node:test';",
    "export * from 'vite-plus/test';",
    "const runner = await import('node:test');",
    "const {test: check} = require('node:test');",
    "import runner = require('node:test');"
  ])
    assert.strictEqual(
      lintRule('test-classification', { 'test/case.test.ts': source }).length,
      1,
      source
    );
});

testStable('rejects global tests while respecting unrelated lexical bindings', () => {
  const diagnostics = lintRule('test-classification', {
    'test/raw.test.ts': "test('raw', () => {}); it.each([1])('raw', () => {});",
    'test/safe.test.ts':
      "function inspect(test) { test(); } /a/.test('a'); const regex = new RegExp('a'); regex.test('a');"
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('permits classified imports, runner hooks and type imports', () => {
  const diagnostics = lintRule(
    'test-classification',
    {
      'apps/web/src/a.test.ts':
        "import {testStable, testRegression} from '@study/testing/vitest'; import {expect, beforeEach, describe} from 'vite-plus/test'; testStable.each([1])('case', n => {}); testRegression({regression: 'evidence_integrity'})('case', () => {});",
      'apps/server/test/a.test.ts':
        "import type {TestContext} from 'node:test'; import {beforeEach, describe} from 'node:test'; import {testStable} from '@study/testing/vitest'; testStable('case', () => {});"
    },
    true
  );

  expect(diagnostics).toStrictEqual([]);
});

testStable(
  'rejects classification aliases, fake definitions, namespace imports and modifiers',
  () => {
    for (const source of [
      "import {testStable as test} from '@study/testing/vitest';",
      "import * as tests from '@study/testing/vitest';",
      "import {testStable} from './fake.ts'; testStable('case', () => {});",
      'function testStable() {} testStable();',
      "import {testStable} from '@study/testing/vitest'; testStable.only('case', () => {});",
      "import {testRegression} from '@study/testing/vitest'; testRegression({regression:'evidence_integrity'}).skip('case', () => {});"
    ])
      assert.strictEqual(
        lintRule('test-classification', { 'apps/web/src/a.test.ts': source }, true).length,
        1,
        source
      );
  }
);

testStable('rejects runtime subtests and permits classified tests in collected suites', () => {
  const diagnostics = lintRule(
    'test-classification',
    {
      'apps/server/test/a.test.ts':
        "import {describe} from 'vite-plus/test'; import {testStable} from '@study/testing/vitest'; describe('group', () => { testStable('child', () => {}); }); testStable('parent', async t => { await t.test('raw', () => {}); });"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('only canonical adapter implementations may access raw registration', () => {
  const diagnostics = lintRule(
    'test-classification',
    {
      'packages/testing/src/node.ts':
        "import {test} from 'node:test'; export const testStable = test;",
      'packages/testing/src/vitest.ts':
        "import {test} from 'vite-plus/test'; export const testStable = test;",
      'apps/server/test/testing/node.ts':
        "import {test} from 'node:test'; export const testStable = test;"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('requires the public alias and rejects aliases of registrations', () => {
  const diagnostics = lintRule(
    'test-classification',
    {
      'apps/web/src/a.test.ts':
        "import {testStable} from '../../../packages/testing/src/vitest.ts';",
      'apps/web/src/b.test.ts':
        "import {testStable} from '@study/testing/vitest'; const check = testStable;",
      'apps/web/src/c.test.ts':
        "import {testRegression} from '@study/testing/vitest'; const check = testRegression({regression:'evidence_integrity'});"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

testStable('rejects global namespace tests and focus or skip options', () => {
  const diagnostics = lintRule(
    'test-classification',
    {
      'apps/web/src/a.test.ts': "globalThis.test('raw', () => {}); window.it('raw', () => {});",
      'apps/web/src/b.test.ts':
        "import {testStable} from '@study/testing/vitest'; testStable('case', {only:true}, () => {}); testStable.each([1])('case', {skip:true}, () => {});"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
});

testStable('metadata must be explicit and temporary removal conditions meaningful', () => {
  const diagnostics = lintRule(
    'test-classification',
    {
      'apps/web/src/a.test.ts':
        "import {testMigration, testRegression} from '@study/testing/vitest'; testMigration(metadata)('case', () => {}); testRegression({...metadata})('case', () => {}); testMigration({migration:'source_upgrade',retention:'temporary',removeWhen:'  '})('case', () => {});"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

testStable('classified registration cannot escape through reexports, objects or assignment', () => {
  for (const source of [
    "export {testStable as check} from '@study/testing/vitest';",
    "const tests = await import('@study/testing/vitest');",
    "import {testStable} from '@study/testing/vitest'; const tests = {check:testStable};",
    "import {testStable} from '@study/testing/vitest'; let check; check = testStable.each;",
    "import {testRegression} from '@study/testing/vitest'; let check; check = testRegression({regression:'evidence_integrity'});"
  ])
    assert.strictEqual(
      lintRule('test-classification', { 'test/a.test.ts': source }).length,
      1,
      source
    );
});

testStable('nested contexts cannot hide raw subtests behind destructuring or type aliases', () => {
  const diagnostics = lintRule('test-classification', {
    'test/a.test.ts':
      "import {testStable} from '@study/testing/vitest'; testStable('parent', t => { const {test:check} = t; check('raw', () => {}); });",
    'test/b.test.ts':
      "import type {TestContext as Context} from 'vite-plus/test'; function nested(context: Context) { context.test('raw', () => {}); }"
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});
