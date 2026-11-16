import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { packageExportIssues } from '../package-export-policy.ts';
import { lintRule } from '../test/utils.ts';

testStable('the server testing facet stays inside its feature-service fixtures', () => {
  expect(
    packageExportIssues('apps/server', { './testing': './test/testing/study-materials.ts' })
  ).toEqual([]);
  expect(packageExportIssues('apps/server', { './testing': './test/private.ts' })).toHaveLength(1);
  expect(
    packageExportIssues('apps/server', { './client': './test/testing/study-materials.ts' })
  ).toHaveLength(1);
});

testStable(
  'workspace libraries are imported through their root with only approved facets',
  async () => {
    const diagnostics = await lintRule(
      'package-root-exports',
      {
        'apps/server/src/ordinary.ts': "import { StudyError } from '@study/contracts/errors';\n",
        'apps/server/src/type.ts': "import type { Db } from '@study/db/schema';\n",
        'apps/server/src/reexport.ts': "export * from '@study/localization/catalog';\n",
        'apps/server/src/reexport-type.ts':
          "export type { Locale } from '@study/localization/catalog';\n",
        'apps/server/src/type-query.ts':
          "type Catalog = import('@study/localization/catalog').Locale;\n",
        'apps/server/src/dynamic.ts': "const load = import('@study/theme/private');\n",
        'apps/server/src/require.ts': "const { parse } = require('@study/contracts/errors');\n",
        'apps/server/src/import-equals.ts': "import colors = require('@study/theme/private');\n",
        'apps/server/src/root.ts': "import { StudyError } from '@study/contracts';\n",
        'apps/client/src/approved.ts':
          "import '@study/contracts/react'; import '@study/ui/theme.css'; import '@study/ui/styles.css';\n",
        'apps/client/src/app-facets.ts': `import '@study/server/runtime';
 import '@study/server/runtime/database';
 import '@study/client/feature-previews/catalog';

`,
        'tooling/scripts/dev.ts': "import '@study/tooling/development/rpc-proxy';\n"
      },
      true
    );

    expect(
      diagnostics
        .map(({ code, filename }) => [code, filename.split('/').at(-1)])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    ).toStrictEqual(
      [
        'ordinary.ts',
        'type.ts',
        'reexport.ts',
        'reexport-type.ts',
        'type-query.ts',
        'dynamic.ts',
        'require.ts',
        'import-equals.ts'
      ]
        .map((name) => ['study(package-root-exports)', name])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    );
  }
);

testStable('known packages reject unknown facets and app roots without exports', async () => {
  const diagnostics = await lintRule(
    'package-root-exports',
    {
      'apps/client/src/unknown.ts': "import '@study/contracts/not-a-facet';\n",
      'apps/client/src/client-root.ts': "import '@study/client';\n",
      'apps/server/src/server.ts': "import '@study/server/runtime';\n"
    },
    true
  );

  expect(diagnostics.map(({ filename }) => filename.split('/').at(-1)).sort()).toStrictEqual([
    'client-root.ts',
    'unknown.ts'
  ]);
});
