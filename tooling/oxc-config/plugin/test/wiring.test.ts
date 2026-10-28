import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkWiring } from './utils.ts';

const rules = ['alpha'];

const configured = { 'study/alpha': 'error' };

test('wiring rejects missing, unknown, disabled and untested rules', () => {
  assert.throws(() => checkWiring(rules, {}, ['alpha.test.ts']));
  assert.throws(() =>
    checkWiring(rules, { ...configured, 'study/unknown': 'error' }, ['alpha.test.ts'])
  );
  assert.throws(() => checkWiring(rules, { 'study/alpha': 'off' }, ['alpha.test.ts']));
  assert.throws(() => checkWiring(rules, configured, []));
  assert.throws(() =>
    checkWiring(rules, configured, ['alpha.test.ts'], [{ 'study/alpha': 'off' }])
  );
  assert.throws(() =>
    checkWiring(rules, configured, ['alpha.test.ts'], [{ 'study/unknown': 'error' }])
  );
  assert.doesNotThrow(() => checkWiring(rules, configured, ['alpha.test.ts']));
});

test('production registry, config and sibling test files agree', async () => {
  const { readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { default: plugin } = await import('../index.ts');
  const { lint } = await import('../../lint.ts');
  const { pluginPath, root } = await import('./utils.ts');

  checkWiring(
    Object.keys(plugin.rules),
    lint.rules,
    readdirSync(join(root, pluginPath, 'rules')),
    lint.overrides.map(({ rules }) => rules)
  );
});
