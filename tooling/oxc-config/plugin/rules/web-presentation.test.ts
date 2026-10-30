import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('web markup cannot bypass shared presentation with native styles', () => {
  const diagnostics = lintRule(
    'web-presentation',
    {
      'apps/web/src/example.tsx': `export const view = <div className="layout"><span style={{ fontSize: 20 }} /><nav {...{ ['className']: 'footer' }} /></div>;`,
      'apps/web/src/example.test.tsx': `export const fixture = <div className="fixture" />;`,
      'packages/ui/src/example.tsx': `export const view = <div className="shared" />;`
    },
    true
  );

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('only the web bootstrap imports approved global stylesheets', () => {
  const diagnostics = lintRule(
    'web-presentation',
    {
      'apps/web/src/main.tsx': `import './styles.css'; import '@study/ui/styles.css'; import './sidebar.css';`,
      'apps/web/src/example.tsx': `import './sidebar.css'; import './layout.module.scss'; import '@study/ui/styles.css';`,
      'packages/ui/src/example.tsx': `import './sidebar.css';`
    },
    true
  );

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('web composition remains free to use semantic props and unstyled HTML', () => {
  assert.deepEqual(
    lintRule(
      'web-presentation',
      {
        'apps/web/src/example.tsx': `import { Sidebar } from '@study/ui/sidebar'; export const view = <Sidebar.Footer trailing={<Sidebar.Utility variant="secondary" />}><form aria-label="Create" /></Sidebar.Footer>;`
      },
      true
    ),
    []
  );
});
