import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('rejects upward dependencies, cross-page imports and private feature imports', () => {
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

  assert.strictEqual(diagnostics.length, 7, JSON.stringify(diagnostics));
});

testStable('allows composition, same-domain internals and explicit feature entry points', () => {
  expect(
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
    )
  ).toStrictEqual([]);
});

testStable('restricts the raw transport and root-level application files', () => {
  const diagnostics = lintRule(
    'web-boundaries',
    {
      'apps/web/src/extra.ts': `export const x = 1;`,
      'apps/web/src/pages/home/leak.ts': `import { studyClient } from '../../lib/study-client/client'; studyClient.projects.projects.query({}); fetch('/trpc');`
    },
    true
  );

  assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
});

testStable('canonical folders, type imports and alternate loaders cannot bypass ownership', () => {
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

  assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
});

testStable('permits Query while keeping raw RPC in the transport adapter', () => {
  expect(
    lintRule(
      'web-boundaries',
      {
        'apps/web/src/app/providers.tsx': `import { QueryClientProvider } from '@tanstack/react-query';`,
        'apps/web/src/features/library/library.queries.ts': `import { queryOptions } from '@tanstack/react-query';`
      },
      true
    )
  ).toStrictEqual([]);
});

testStable(
  'Material routes compose the feature entrypoint while internals stay feature-owned',
  () => {
    assert.strictEqual(
      lintRule(
        'web-boundaries',
        {
          'apps/web/src/routes/library.tsx': `import {LibraryPage} from '../features/material-library/library-page';`,
          'apps/web/src/routes/materials.$materialId.tsx': `import {ReaderPage} from '../features/material-library/reader-page';`
        },
        true
      ).length,
      2
    );
    expect(
      lintRule(
        'web-boundaries',
        {
          'apps/web/src/routes/library.tsx': `import {LibraryPage, materialsOptions} from '../features/material-library';`,
          'apps/web/src/routes/materials.$materialId.tsx': `import {ReaderPage, materialId} from '../features/material-library';`,
          'apps/web/src/features/material-library/index.ts': `export {LibraryPage} from './library-page';`,
          'apps/web/src/features/material-library/import-operation.ts': `import {importMutationOptions} from './material-library.queries';`,
          'apps/web/src/app/shell/shell.tsx': `import './shell.css';`
        },
        true
      )
    ).toStrictEqual([]);
  }
);

testStable('private web aliases preserve downward ownership and transport restrictions', () => {
  const diagnostics = lintRule(
    'web-boundaries',
    {
      'apps/web/src/lib/alias.ts':
        "import '#web/pages/home/page.tsx'; import '#web/routeTree.gen.ts';",
      'apps/web/src/pages/home/alias.ts': "import '#web/lib/study-client/client.ts';",
      'apps/web/src/features/search/alias.ts': "import '#web/features/library/private.ts';",
      'apps/web/src/app/alias.ts': "import '#web/features/library/index.ts';"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
});
