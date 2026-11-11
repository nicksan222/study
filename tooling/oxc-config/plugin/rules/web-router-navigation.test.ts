import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('rejects manual browser navigation and raw search decoding', async () => {
  const diagnostics = await lintRule(
    'web-router-navigation',
    {
      'apps/web/src/pages/home/use-page.ts': `window.history.pushState({}, '', '/home'); history.replaceState({}, '', '/'); window.location.hash = '/home'; location.assign('/home'); const search = new URLSearchParams(location.search); const path = location.pathname;`,
      'apps/web/src/pages/home/page.view.tsx': `export const view = <><a href="/home">Home</a><a href="#/settings">Settings</a><a href="https://example.com">External</a></>;`
    },
    true
  );

  assert.strictEqual(diagnostics.length, 8, JSON.stringify(diagnostics));
});

testStable('allows the router adapter, transport discovery and external links', async () => {
  expect(
    await lintRule(
      'web-router-navigation',
      {
        'apps/web/src/app/router.ts': `const parse = (search) => new URLSearchParams(search);`,
        'apps/web/src/lib/study-client/client.ts': `const origin = window.location.origin;`,
        'apps/web/src/pages/home/page.view.tsx': `import { Link } from '@tanstack/react-router'; export const view = <><Link to="/home" /><a href="https://example.com">External</a></>;`
      },
      true
    )
  ).toStrictEqual([]);
});

testStable('destructured browser aliases cannot bypass TanStack navigation', async () => {
  const diagnostics = await lintRule(
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

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

testStable(
  'rejects hash history and nonstandard internal paths including route declarations',
  async () => {
    const diagnostics = await lintRule(
      'web-router-navigation',
      {
        'apps/web/src/app/router.ts': `import { createHashHistory as history } from '@tanstack/react-router';`,
        'apps/web/src/routes/MediaList.tsx': `import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/MediaList')({ component: Page });`,
        'apps/web/src/app/shell/links.ts': `export const links = ['/Home', '/media_list', '/#/notes', '/notes/'];`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 6, JSON.stringify(diagnostics));
  }
);

testStable(
  'permits browser history, kebab-case paths and parameterized route segments',
  async () => {
    expect(
      await lintRule(
        'web-router-navigation',
        {
          'apps/web/src/app/router.ts': `import { createBrowserHistory } from '@tanstack/react-router'; const parse = (search) => new URLSearchParams(search);`,
          'apps/web/src/app/shell/links.ts': `export const links = ['/', '/home', '/media-list', '/projects/$projectId/notes/$noteId', 'https://example.com/SomePage'];`
        },
        true
      )
    ).toStrictEqual([]);
  }
);

testStable(
  'Home project links and collection destinations use router search rather than manual browser navigation',
  async () => {
    const diagnostics = await lintRule(
      'web-router-navigation',
      {
        'apps/web/src/pages/home/unsafe.tsx': `export const view = <a href="/projects?project=9007199254740993">Collections</a>;`,
        'apps/web/src/features/collections/unsafe.tsx': `window.location.assign('/library?project=9007199254740993');`,
        'apps/web/src/pages/home/page.view.tsx': `import { Link } from '@tanstack/react-router'; export const view = <><Link to="/notes" search={{project: search.project}} /><Link to="/library" search={{project: search.project}} /><Link to="/projects" search={{project: search.project}} /></>;`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/unsafe.tsx')));
  }
);

testStable(
  'proposal result and captured input links use typed route search for exact versions',
  async () => {
    expect(
      await lintRule(
        'web-router-navigation',
        {
          'apps/web/src/features/document-editing/proposal-review.tsx': `
      import {Link} from '@tanstack/react-router';
      export const result = <Link to="/materials/$materialId" params={{materialId: String(materialId)}} search={{version: String(resultVersionId)}} />;
    `,
          'apps/web/src/features/note-workspace/history.tsx': `
      import {Link} from '@tanstack/react-router';
      export const input = <Link to="/materials/$materialId" params={{materialId: String(input.materialId)}} search={{version: String(input.versionId)}} />;
    `
        },
        true
      )
    ).toStrictEqual([]);
    const diagnostics = await lintRule(
      'web-router-navigation',
      {
        'apps/web/src/features/document-editing/proposal-review.tsx': `
      export const open = () => window.location.assign('/materials/41?version=103');
      export const result = <a href="/materials/41?version=103">Open</a>;
    `
      },
      true
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable(
  'permits bound TanStack index route IDs while retaining strict actual navigation paths',
  async () => {
    const diagnostics = await lintRule(
      'web-router-navigation',
      {
        'apps/web/src/routes/notes.index.tsx': `import { createFileRoute as fileRoute } from '@tanstack/react-router';
        export const Route = fileRoute('/notes/')({component: Page});`,
        'apps/web/src/routes/notes.tsx': `import { createFileRoute } from '@tanstack/react-router'; createFileRoute('/notes/')({});`,
        'apps/web/src/routes/notes/index.tsx': `import { createFileRoute } from '@tanstack/react-router'; createFileRoute('/notes/')({});`,
        'apps/web/src/routes/unsafe.tsx': `import { createFileRoute as fileRoute } from '@tanstack/react-router';
        fileRoute('/Notes/')({});
        function shadow(fileRoute) { return fileRoute('/notes/')({}); }
        const badNavigation = '/notes/';`,
        'apps/web/src/routes/other.tsx': `import { createFileRoute } from 'another-router'; createFileRoute('/notes/')({});`,
        'apps/web/src/app/shell/links.tsx': `import { Link } from '@tanstack/react-router'; const view = <Link to="/notes/" />;`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 6, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/notes.index.tsx')));
  }
);
