import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable('web markup cannot bypass shared presentation with native styles', async () => {
  const diagnostics = await lintRule(
    'web-presentation',
    {
      'apps/client/src/example.tsx': `export const view = <div className="layout"><span style={{ fontSize: 20 }} /><nav {...{ ['className']: 'footer' }} /></div>;`,
      'apps/client/src/example.test.tsx': `export const fixture = <div className="fixture" />;`,
      'packages/ui/src/example.tsx': `export const view = <div className="shared" />;`
    },
    true
  );

  test.assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test.stable('only the web bootstrap imports approved global stylesheets', async () => {
  const diagnostics = await lintRule(
    'web-presentation',
    {
      'apps/client/src/main.tsx': `import './styles.css'; import '@study/ui/styles.css'; import './sidebar.css';`,
      'apps/client/src/example.tsx': `import './sidebar.css'; import './layout.module.scss'; import '@study/ui/styles.css';`,
      'packages/ui/src/example.tsx': `import './sidebar.css';`
    },
    true
  );

  test.assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test.stable('web composition remains free to use semantic props and unstyled HTML', async () => {
  test
    .expect(
      await lintRule(
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
    )
    .toStrictEqual([]);
});
