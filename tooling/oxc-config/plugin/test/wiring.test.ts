import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { checkWiring } from './utils.ts';

const rules = ['alpha'];

const configured = { 'study/alpha': 'error' };

testStable('wiring rejects missing, unknown, disabled and untested rules', () => {
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

testStable('production registry, config and sibling test files agree', async () => {
  const { readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { default: plugin } = await import('../index.ts');
  const { lint } = await import('#tooling/oxc-config/lint');
  const { pluginPath, root } = await import('./utils.ts');

  checkWiring(
    Object.keys(plugin.rules),
    lint.rules,
    readdirSync(join(root, pluginPath, 'rules')),
    lint.overrides.map(({ rules }) => rules)
  );
});
