import { test } from '@study/testing';

import { checkWiring } from './utils.ts';

const rules = ['alpha'];

const configured = { 'study/alpha': 'error' };

test.stable('wiring rejects missing, unknown, disabled and untested rules', () => {
  test.assert.throws(() => checkWiring(rules, {}, ['alpha.test.ts']));
  test.assert.throws(() =>
    checkWiring(rules, { ...configured, 'study/unknown': 'error' }, ['alpha.test.ts'])
  );
  test.assert.throws(() => checkWiring(rules, { 'study/alpha': 'off' }, ['alpha.test.ts']));
  test.assert.throws(() => checkWiring(rules, configured, []));
  test.assert.throws(() =>
    checkWiring(rules, configured, ['alpha.test.ts'], [{ 'study/alpha': 'off' }])
  );
  test.assert.throws(() =>
    checkWiring(rules, configured, ['alpha.test.ts'], [{ 'study/unknown': 'error' }])
  );
  test.assert.doesNotThrow(() => checkWiring(rules, configured, ['alpha.test.ts']));
});

test.stable('production registry, config and sibling test files agree', async () => {
  const { default: plugin } = await import('../index.ts');
  const { lint } = await import('#tooling/oxc-config/lint');
  const { pluginPath, root } = await import('./utils.ts');

  checkWiring(
    Object.keys(plugin.rules),
    lint.rules,
    Array.from(new Bun.Glob('*').scanSync({ cwd: `${root}${pluginPath}/rules` })),
    lint.overrides.map(({ rules }) => rules)
  );
});
