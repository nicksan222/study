import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable(
  'requires page presentation and behavioral tests beside each page',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'web-page-contract',
      {
        'apps/client/src/pages/home/page.tsx': `export function Page() { return null; }`,
        'apps/client/src/pages/home/page.logic.ts': `export const load = () => 1;`,
        'apps/client/src/pages/home/use-page.ts': `export const usePage = () => 1;`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

test.stable(
  'accepts tested static pages without inventing asynchronous logic',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lintRule(
        { assert },
        'web-page-contract',
        {
          'apps/client/src/pages/home/page.tsx': `import { PageView } from './page.view'; export function Page() { return <PageView />; }`,
          'apps/client/src/pages/home/page.view.tsx': `export function PageView() { return null; }`,
          'apps/client/src/pages/home/page.test.tsx': `export {};`,
          'apps/client/src/pages/home/page.view.test.tsx': `export {};`
        },
        true
      )
    ).toStrictEqual([]);
  }
);

test.stable(
  'keeps route modules declarative and page composition free of state',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'web-page-contract',
      {
        'apps/client/src/routes/Home.tsx': `import { useState } from 'react'; export const extra = 1; export const Route = {}; const Page = () => <div />;`,
        'apps/client/src/pages/home/page.tsx': `import { useState } from 'react'; export function Page() { const [x] = useState(1); return null; }`,
        'apps/client/src/pages/home/page.view.tsx': `export const PageView = () => null;`,
        'apps/client/src/pages/home/page.test.tsx': `export {};`,
        'apps/client/src/pages/home/page.view.test.tsx': `export {};`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

test.stable(
  'route components cannot hide lifecycle ownership behind imported hooks or inline functions',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'web-page-contract',
      {
        'apps/client/src/routes/Home.tsx': `
      import { createFileRoute } from '@tanstack/react-router';
      import { useSidebar } from '../app/shell/use-sidebar';
      export const Route = createFileRoute('/Home')({
        component: function Page() { useSidebar({}); return null; }
      });
    `
      },
      true
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'route boundaries reference imported components and may validate or redirect inline',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lintRule(
        { assert },
        'web-page-contract',
        {
          'apps/client/src/routes/Home.tsx': `
      import { createFileRoute, redirect } from '@tanstack/react-router';
      import { Page } from '../pages/home/page';
      export const Route = createFileRoute('/Home')({
        component: Page, beforeLoad: () => { throw redirect({ to: '/Settings' }); }
      });
    `
        },
        true
      )
    ).toStrictEqual([]);
  }
);
