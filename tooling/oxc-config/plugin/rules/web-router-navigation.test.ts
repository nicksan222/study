import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('rejects manual browser navigation and raw search decoding', () => {
  const diagnostics = lintRule(
    'web-router-navigation',
    {
      'apps/web/src/pages/home/use-page.ts': `window.history.pushState({}, '', '/home'); history.replaceState({}, '', '/'); window.location.hash = '/home'; location.assign('/home'); const search = new URLSearchParams(location.search); const path = location.pathname;`,
      'apps/web/src/pages/home/page.view.tsx': `export const view = <><a href="/home">Home</a><a href="#/settings">Settings</a><a href="https://example.com">External</a></>;`
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
        'apps/web/src/pages/home/page.view.tsx': `import { Link } from '@tanstack/react-router'; export const view = <><Link to="/home" /><a href="https://example.com">External</a></>;`
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
      navigation.pushState({}, '', '/home');
      url.assign('/settings');
      const Search = URLSearchParams;
      export const state = new Search('?id=1');
    `
    },
    true
  );

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('rejects hash history and nonstandard internal paths including route declarations', () => {
  const diagnostics = lintRule(
    'web-router-navigation',
    {
      'apps/web/src/app/router.ts': `import { createHashHistory as history } from '@tanstack/react-router';`,
      'apps/web/src/routes/MediaList.tsx': `import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/MediaList')({ component: Page });`,
      'apps/web/src/app/shell/links.ts': `export const links = ['/Home', '/media_list', '/#/sessions', '/sessions/'];`
    },
    true
  );

  assert.equal(diagnostics.length, 6, JSON.stringify(diagnostics));
});

test('permits browser history, kebab-case paths and parameterized route segments', () => {
  assert.deepEqual(
    lintRule(
      'web-router-navigation',
      {
        'apps/web/src/app/router.ts': `import { createBrowserHistory } from '@tanstack/react-router'; const parse = (search) => new URLSearchParams(search);`,
        'apps/web/src/app/shell/links.ts': `export const links = ['/', '/home', '/media-list', '/projects/$projectId/sessions/$sessionId', 'https://example.com/SomePage'];`
      },
      true
    ),
    []
  );
});
