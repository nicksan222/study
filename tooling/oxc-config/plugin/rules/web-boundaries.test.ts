import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable(
  'rejects upward dependencies, cross-page imports and private feature imports',
  async () => {
    const diagnostics = await lintRule(
      'web-boundaries',
      {
        'apps/client/src/lib/leak.ts': `import '../pages/home/page'; export * from '../app/app';`,
        'apps/client/src/features/search/private.ts': `import '../../app/app'; import '../library/library.logic';`,
        'apps/client/src/pages/home/page.tsx': `import '../settings/page'; import '../../features/library/library.logic';`,
        'apps/client/src/lib/dynamic.ts': `export const load = () => import('../features/search/private');`
      },
      true
    );

    test.assert.strictEqual(diagnostics.length, 7, JSON.stringify(diagnostics));
  }
);

test.stable(
  'allows composition, same-domain internals and explicit feature entry points',
  async () => {
    test
      .expect(
        await lintRule(
          'web-boundaries',
          {
            'apps/client/src/app/shell/sidebar.tsx': `import '../../features/library'; import '../../lib/i18n';`,
            'apps/client/src/pages/home/page.tsx': `import './page.view'; import '../../features/library/index';`,
            'apps/client/src/features/library/index.ts': `export * from './library-list';`,
            'apps/client/src/features/library/library.logic.ts': `import '../../lib/study-client/operations';`,
            'apps/client/src/lib/example.test.ts': `import '../pages/home/page';`
          },
          true
        )
      )
      .toStrictEqual([]);
  }
);

test.stable('restricts the raw transport and root-level application files', async () => {
  const diagnostics = await lintRule(
    'web-boundaries',
    {
      'apps/client/src/extra.ts': `export const x = 1;`,
      'apps/client/src/pages/home/leak.ts': `import { studyClient } from '../../lib/study-client/client'; studyClient.projects.projects.query({}); fetch('/trpc');`
    },
    true
  );

  test.assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test.stable(
  'canonical folders, type imports and alternate loaders cannot bypass ownership',
  async () => {
    const diagnostics = await lintRule(
      'web-boundaries',
      {
        'apps/client/src/misc/example.ts': 'export const value = 1;',
        'apps/client/src/lib/leak.ts': `
      export type Page = import('../pages/home/page').Page;
      export const dynamic = (path) => import(path);
      const load = require;
      export const privateFeature = load('../features/library/library.logic');
    `,
        'apps/client/src/pages/home/page.tsx': "import '../../test/render-page';"
      },
      true
    );

    test.assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
  }
);

test.stable('permits Query while keeping raw RPC in the transport adapter', async () => {
  test
    .expect(
      await lintRule(
        'web-boundaries',
        {
          'apps/client/src/app/providers.tsx': `import { RpcProvider } from '@study/contracts/react';`,
          'apps/client/src/features/library/library.queries.ts': `import { rpc } from '@study/contracts/react';`
        },
        true
      )
    )
    .toStrictEqual([]);
});

test.stable(
  'Material routes compose the feature entrypoint while internals stay feature-owned',
  async () => {
    test.assert.strictEqual(
      (
        await lintRule(
          'web-boundaries',
          {
            'apps/client/src/routes/library.tsx': `import {LibraryPage} from '../features/material-library/library-page';`,
            'apps/client/src/routes/materials.$materialId.tsx': `import {ReaderPage} from '../features/material-library/reader-page';`
          },
          true
        )
      ).length,
      2
    );
    test
      .expect(
        await lintRule(
          'web-boundaries',
          {
            'apps/client/src/routes/library.tsx': `import {LibraryPage, materialsOptions} from '../features/material-library';`,
            'apps/client/src/routes/materials.$materialId.tsx': `import {ReaderPage, materialId} from '../features/material-library';`,
            'apps/client/src/features/material-library/index.ts': `export {LibraryPage} from './library-page';`,
            'apps/client/src/features/material-library/import-operation.ts': `import {importMutationOptions} from './material-library.queries';`,
            'apps/client/src/app/shell/shell.tsx': `import './shell.css';`
          },
          true
        )
      )
      .toStrictEqual([]);
  }
);

test.stable(
  'private web aliases preserve downward ownership and transport restrictions',
  async () => {
    const diagnostics = await lintRule(
      'web-boundaries',
      {
        'apps/client/src/lib/alias.ts':
          "import '#client/pages/home/page.tsx'; import '#client/routeTree.gen.ts';",
        'apps/client/src/pages/home/alias.ts': "import '#client/lib/study-client/client.ts';",
        'apps/client/src/features/search/alias.ts': "import '#client/features/library/private.ts';",
        'apps/client/src/app/alias.ts': "import '#client/features/library/index.ts';"
      },
      true
    );

    test.assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

test.stable(
  'only the isolated feature preview layer may compose private feature views',
  async () => {
    test
      .expect(
        (
          await lintRule(
            'web-boundaries',
            {
              'apps/client/src/feature-previews/index.tsx':
                "import { QuizQuestion } from '../features/practice/quiz-question'; export { QuizQuestion };",
              'apps/client/src/features/practice/leak.ts': "import '../../feature-previews';"
            },
            true
          )
        ).map(({ filename }) => filename.split('/').at(-1))
      )
      .toStrictEqual(['leak.ts']);
  }
);

test.stable('raw RPC execution is limited to the single runtime transport adapter', async () => {
  const diagnostics = await lintRule(
    'web-boundaries',
    {
      'apps/client/src/lib/effect/rpc.ts': `import { makeStudyClient } from '@study/server/client'; import { RpcGroup } from 'effect/rpc';`,
      'apps/client/src/lib/study-client/bypass.ts': `import { makeStudyClient } from '@study/server/client';`,
      'apps/client/src/test/native.ts': `import type { RpcClient } from 'effect/rpc';`
    },
    true
  );

  test.expect(diagnostics).toHaveLength(1);
});
