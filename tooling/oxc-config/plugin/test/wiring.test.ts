import { test } from '@study/testing';

import { checkWiring } from './utils.ts';

const rules = ['alpha'];

const configured = { 'study/alpha': 'error' };

test.stable(
  'wiring rejects missing, unknown, disabled and untested rules',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    assert.throws(() => checkWiring({ assert }, rules, {}, ['alpha.test.ts']));
    assert.throws(() =>
      checkWiring({ assert }, rules, { ...configured, 'study/unknown': 'error' }, ['alpha.test.ts'])
    );
    assert.throws(() =>
      checkWiring({ assert }, rules, { 'study/alpha': 'off' }, ['alpha.test.ts'])
    );
    assert.throws(() => checkWiring({ assert }, rules, configured, []));
    assert.throws(() =>
      checkWiring({ assert }, rules, configured, ['alpha.test.ts'], [{ 'study/alpha': 'off' }])
    );
    assert.throws(() =>
      checkWiring({ assert }, rules, configured, ['alpha.test.ts'], [{ 'study/unknown': 'error' }])
    );
    assert.doesNotThrow(() => checkWiring({ assert }, rules, configured, ['alpha.test.ts']));
  }
);

test.stable(
  'production registry, config and sibling test files agree',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { default: plugin } = await import('../index.ts');
    const { lint } = await import('#tooling/oxc-config/lint');
    const { pluginPath, root } = await import('./utils.ts');

    checkWiring(
      { assert },
      Object.keys(plugin.rules),
      lint.rules,
      Array.from(new Bun.Glob('*').scanSync({ cwd: `${root}${pluginPath}/rules` })),
      lint.overrides.map(({ rules }) => rules)
    );
  }
);
