import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('requires page presentation and behavioral tests beside each page', () => {
  const diagnostics = lintRule(
    'web-page-contract',
    {
      'apps/web/src/pages/home/page.tsx': `export function Page() { return null; }`,
      'apps/web/src/pages/home/page.logic.ts': `export const load = () => 1;`,
      'apps/web/src/pages/home/use-page.ts': `export const usePage = () => 1;`
    },
    true
  );

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('accepts tested static pages without inventing asynchronous logic', () => {
  assert.deepEqual(
    lintRule(
      'web-page-contract',
      {
        'apps/web/src/pages/home/page.tsx': `import { PageView } from './page.view'; export function Page() { return <PageView />; }`,
        'apps/web/src/pages/home/page.view.tsx': `export function PageView() { return null; }`,
        'apps/web/src/pages/home/page.test.tsx': `export {};`,
        'apps/web/src/pages/home/page.view.test.tsx': `export {};`
      },
      true
    ),
    []
  );
});

test('keeps route modules declarative and page composition free of state', () => {
  const diagnostics = lintRule(
    'web-page-contract',
    {
      'apps/web/src/routes/Home.tsx': `import { useState } from 'react'; export const extra = 1; export const Route = {}; const Page = () => <div />;`,
      'apps/web/src/pages/home/page.tsx': `import { useState } from 'react'; export function Page() { const [x] = useState(1); return null; }`,
      'apps/web/src/pages/home/page.view.tsx': `export const PageView = () => null;`,
      'apps/web/src/pages/home/page.test.tsx': `export {};`,
      'apps/web/src/pages/home/page.view.test.tsx': `export {};`
    },
    true
  );

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('route components cannot hide lifecycle ownership behind imported hooks or inline functions', () => {
  const diagnostics = lintRule(
    'web-page-contract',
    {
      'apps/web/src/routes/Home.tsx': `
      import { createFileRoute } from '@tanstack/react-router';
      import { useSidebar } from '../app/shell/use-sidebar';
      export const Route = createFileRoute('/Home')({
        component: function Page() { useSidebar({}); return null; }
      });
    `
    },
    true
  );

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('route boundaries reference imported components and may validate or redirect inline', () => {
  assert.deepEqual(
    lintRule(
      'web-page-contract',
      {
        'apps/web/src/routes/Home.tsx': `
      import { createFileRoute, redirect } from '@tanstack/react-router';
      import { Page } from '../pages/home/page';
      export const Route = createFileRoute('/Home')({
        component: Page, beforeLoad: () => { throw redirect({ to: '/Settings' }); }
      });
    `
      },
      true
    ),
    []
  );
});
