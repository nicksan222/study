import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('rejects manual browser navigation and raw search decoding', () => {
  const diagnostics = lintRule(
    'web-router-navigation',
    {
      'apps/web/src/pages/home/use-page.ts': `window.history.pushState({}, '', '/Home'); history.replaceState({}, '', '/'); window.location.hash = '/Home'; location.assign('/Home'); const search = new URLSearchParams(location.search); const path = location.pathname;`,
      'apps/web/src/pages/home/page.view.tsx': `export const view = <><a href="/Home">Home</a><a href="#/Settings">Settings</a><a href="https://example.com">External</a></>;`
    },
    true
  );

  assert.equal(diagnostics.length, 8, JSON.stringify(diagnostics));
});

test('allows the router adapter, transport discovery and external links', () => {
  assert.deepEqual(
    lintRule(
      'web-router-navigation',
      {
        'apps/web/src/app/router.ts': `const parse = (search) => new URLSearchParams(search);`,
        'apps/web/src/lib/study-client/client.ts': `const origin = window.location.origin;`,
        'apps/web/src/pages/home/page.view.tsx': `import { Link } from '@tanstack/react-router'; export const view = <><Link to="/Home" /><a href="https://example.com">External</a></>;`
      },
      true
    ),
    []
  );
});

test('destructured browser aliases cannot bypass TanStack navigation', () => {
  const diagnostics = lintRule(
    'web-router-navigation',
    {
      'apps/web/src/pages/home/use-page.ts': `
      const { history: navigation, location: url } = window;
      navigation.pushState({}, '', '/Home');
      url.assign('/Settings');
      const Search = URLSearchParams;
      export const state = new Search('?id=1');
    `
    },
    true
  );

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});
