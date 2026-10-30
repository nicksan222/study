import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('rejects upward dependencies, cross-page imports and private feature imports', () => {
  const diagnostics = lintRule(
    'web-boundaries',
    {
      'apps/web/src/lib/leak.ts': `import '../pages/home/page'; export * from '../app/app';`,
      'apps/web/src/features/search/private.ts': `import '../../app/app'; import '../library/library.logic';`,
      'apps/web/src/pages/home/page.tsx': `import '../settings/page'; import '../../features/library/library.logic';`,
      'apps/web/src/lib/dynamic.ts': `export const load = () => import('../features/search/private');`
    },
    true
  );

  assert.equal(diagnostics.length, 7, JSON.stringify(diagnostics));
});

test('allows composition, same-domain internals and explicit feature entry points', () => {
  assert.deepEqual(
    lintRule(
      'web-boundaries',
      {
        'apps/web/src/app/shell/sidebar.tsx': `import '../../features/library'; import '../../lib/i18n';`,
        'apps/web/src/pages/home/page.tsx': `import './page.view'; import '../../features/library/index';`,
        'apps/web/src/features/library/index.ts': `export * from './library-list';`,
        'apps/web/src/features/library/library.logic.ts': `import '../../lib/study-client/operations';`,
        'apps/web/src/lib/example.test.ts': `import '../pages/home/page';`
      },
      true
    ),
    []
  );
});

test('restricts the raw transport and root-level application files', () => {
  const diagnostics = lintRule(
    'web-boundaries',
    {
      'apps/web/src/extra.ts': `export const x = 1;`,
      'apps/web/src/pages/home/leak.ts': `import { studyClient } from '../../lib/study-client/client'; studyClient.projects.projects.query({}); fetch('/trpc');`
    },
    true
  );

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('canonical folders, type imports and alternate loaders cannot bypass ownership', () => {
  const diagnostics = lintRule(
    'web-boundaries',
    {
      'apps/web/src/misc/example.ts': 'export const value = 1;',
      'apps/web/src/lib/leak.ts': `
      export type Page = import('../pages/home/page').Page;
      export const dynamic = (path) => import(path);
      const load = require;
      export const privateFeature = load('../features/library/library.logic');
    `,
      'apps/web/src/pages/home/page.tsx': "import '../../test/render-page';"
    },
    true
  );

  assert.equal(diagnostics.length, 5, JSON.stringify(diagnostics));
});

test('permits Query while keeping raw RPC in the transport adapter', () => {
  assert.deepEqual(
    lintRule(
      'web-boundaries',
      {
        'apps/web/src/app/providers.tsx': `import { QueryClientProvider } from '@tanstack/react-query';`,
        'apps/web/src/features/library/library.queries.ts': `import { queryOptions } from '@tanstack/react-query';`
      },
      true
    ),
    []
  );
});
