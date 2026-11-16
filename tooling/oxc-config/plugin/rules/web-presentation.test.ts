import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'web markup cannot bypass shared presentation with native styles',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'web-presentation',
      {
        'apps/client/src/example.tsx': `export const view = <div className="layout"><span style={{ fontSize: 20 }} /><nav {...{ ['className']: 'footer' }} /></div>;`,
        'apps/client/src/example.test.tsx': `export const fixture = <div className="fixture" />;`,
        'packages/ui/src/example.tsx': `export const view = <div className="shared" />;`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'only the web bootstrap imports approved global stylesheets',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'web-presentation',
      {
        'apps/client/src/main.tsx': `import './styles.css'; import '@study/ui/styles.css'; import './sidebar.css';`,
        'apps/client/src/example.tsx': `import './sidebar.css'; import './layout.module.scss'; import '@study/ui/styles.css';`,
        'packages/ui/src/example.tsx': `import './sidebar.css';`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'web composition remains free to use semantic props and unstyled HTML',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lintRule(
        { assert },
        'web-presentation',
        {
          'apps/client/src/example.tsx': `
        import { Sidebar } from '@study/ui';
        export const view = (
          <Sidebar.Footer trailing={<Sidebar.Utility variant="secondary" />}>
            <form aria-label="Create" />
          </Sidebar.Footer>
        );
      `
        },
        true
      )
    ).toStrictEqual([]);
  }
);
