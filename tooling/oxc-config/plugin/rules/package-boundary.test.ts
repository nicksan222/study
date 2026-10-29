import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule, root } from '../test/utils.ts';

test('package ownership, public exports, and browser entrypoints are enforced', () => {
  const diagnostics = lintRule(
    'package-boundary',
    {
      'packages/ui/src/app.ts': "import '@study/web';\n",
      'packages/ui/src/bad.ts': "import '@study/server';\n",
      'packages/localization/src/bad.ts': "export * from '@study/ui/button';\n",
      'packages/db/src/bad.ts': "import type { Account } from '@study/ai';\n",
      'packages/ai/src/bad.ts': "export * from '@study/db';\n",
      'apps/server/src/bad.ts': "import '@study/ui/button';\n",
      'apps/web/src/bad.ts': "export * from '@study/server/runtime';\n",
      'apps/web/src/node.ts': "import 'node:fs';\n",
      'apps/web/src/private.ts': "import '@study/server/shared/not-exported';\n",
      'apps/web/src/relative.ts': "export * from '../../../apps/server/src/index.ts';\n",
      'apps/web/src/absolute.ts': `import '${root}packages/ai/src/index.ts';\n`,
      'apps/web/src/dynamic.ts': "export const db = import('../../../packages/db/src/index.ts');\n",
      'apps/desktop/src/bad.ts': "import '@study/server';\n",
      'apps/landing/src/bad.ts': "import '@study/ui/button';\n",
      'packages/ai/src/good.ts': "import '@study/localization';\n",
      'apps/server/src/good.ts': "import type { jobs } from '@study/db/schema';\n",
      'apps/web/src/good.ts':
        "import '@study/ui/button';\nimport '@study/server';\nimport '@study/server/client';\nimport '@study/server/shared/ids';\n",
      'packages/ui/src/same.ts': "import './other.ts';\n"
    },
    true
  );

  assert.deepEqual(
    diagnostics
      .map(({ code, filename, message }) => {
        assert.equal(code, 'study(package-boundary)');

        return [filename.split('/').slice(-4).join('/'), message];
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [
      ['packages/ui/src/app.ts', '@study/ui cannot depend on @study/web; use its owning layer.'],
      ['packages/ui/src/bad.ts', '@study/ui cannot depend on @study/server; use its owning layer.'],
      [
        'packages/localization/src/bad.ts',
        '@study/localization cannot depend on @study/ui; use its owning layer.'
      ],
      ['packages/db/src/bad.ts', '@study/db cannot depend on @study/ai; use its owning layer.'],
      ['packages/ai/src/bad.ts', '@study/ai cannot depend on @study/db; use its owning layer.'],
      ['apps/server/src/bad.ts', '@study/server cannot depend on @study/ui; use its owning layer.'],
      [
        'apps/web/src/bad.ts',
        '@study/web must use browser-safe @study/server root, client, or shared exports.'
      ],
      ['apps/web/src/node.ts', '@study/web cannot import Node builtins in browser code.'],
      [
        'apps/web/src/private.ts',
        '@study/server/shared/not-exported is not a public package export.'
      ],
      [
        'apps/web/src/relative.ts',
        'Import @study/server through its public package exports instead of a source path.'
      ],
      [
        'apps/web/src/absolute.ts',
        'Import @study/ai through its public package exports instead of a source path.'
      ],
      [
        'apps/web/src/dynamic.ts',
        'Import @study/db through its public package exports instead of a source path.'
      ],
      [
        'apps/desktop/src/bad.ts',
        '@study/desktop cannot depend on @study/server; use its owning layer.'
      ],
      ['apps/landing/src/bad.ts', 'study-landing cannot depend on @study/ui; use its owning layer.']
    ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );
});

test('source and test directory imports cannot bypass package boundaries', () => {
  const diagnostics = lintRule(
    'package-boundary',
    {
      'apps/web/src/relative.ts': "import '../../../apps/server/src/';\n",
      'apps/web/src/absolute.ts': `import '${root}packages/db/test';\n`
    },
    true
  );

  assert.deepEqual(
    diagnostics
      .map(({ code, filename, message }) => {
        assert.equal(code, 'study(package-boundary)');

        return [filename.split('/').at(-1), message];
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [
      [
        'absolute.ts',
        'Import @study/db through its public package exports instead of a source path.'
      ],
      [
        'relative.ts',
        'Import @study/server through its public package exports instead of a source path.'
      ]
    ]
  );
});

test('browser source forbids Node builtins but colocated tests and support may use them', () => {
  const diagnostics = lintRule(
    'package-boundary',
    {
      'apps/web/src/example.test.ts': "import 'node:assert/strict';\n",
      'packages/ui/src/example.test.tsx': "import 'node:fs';\n",
      'apps/web/src/test-support/helper.ts': "import 'node:fs';\n",
      'apps/web/src/test/helper.ts': "import 'node:fs';\n",
      'packages/ui/src/__tests__/helper.ts': "import 'node:fs';\n",
      'apps/web/src/example.ts': "import 'node:fs';\n"
    },
    true
  );

  assert.deepEqual(
    diagnostics.map(({ code, filename, message }) => {
      assert.equal(code, 'study(package-boundary)');

      return [filename.split('/').at(-1), message];
    }),
    [['example.ts', '@study/web cannot import Node builtins in browser code.']]
  );
});

test('manifest exports honor blocked exact and more specific patterns and conditional root', () => {
  const diagnostics = lintRule(
    'package-boundary',
    {
      'apps/web/src/blocked.ts': "import '@study/ui/private';\n",
      'apps/web/src/pattern.ts': "import '@study/ui/internal/secret';\n",
      'apps/web/src/conditional.ts': "import '@study/ui/conditional';\n",
      'apps/web/src/good.ts':
        "import '@study/ui/button';\nimport '@study/ui/nested';\nimport '@study/localization';\n"
    },
    true,
    {
      ui: {
        './*': './src/*.tsx',
        './private': null,
        './internal/*': null,
        './conditional': { import: null, default: './src/fallback.ts' },
        './nested': { import: { browser: './src/browser.ts' }, default: './src/index.ts' }
      },
      localization: { import: './src/index.ts', default: './src/index.ts' }
    }
  );

  assert.deepEqual(
    diagnostics
      .map(({ code, filename, message }) => {
        assert.equal(code, 'study(package-boundary)');

        return [filename.split('/').at(-1), message];
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [
      ['blocked.ts', '@study/ui/private is not a public package export.'],
      ['conditional.ts', '@study/ui/conditional is not a public package export.'],
      ['pattern.ts', '@study/ui/internal/secret is not a public package export.']
    ]
  );
});

test('the theme engine remains browser-safe while UI and server can consume its public API', () => {
  const diagnostics = lintRule(
    'package-boundary',
    {
      'packages/theme/src/bad.ts':
        "import { readFileSync } from 'node:fs'; export { readFileSync };",
      'packages/ui/src/theme.ts': "export { parseTheme } from '@study/theme';",
      'apps/server/src/shared/themes/types.ts': "export type { ThemeFile } from '@study/theme';"
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.match(diagnostics[0]!.message, /cannot import Node builtins/);
});
