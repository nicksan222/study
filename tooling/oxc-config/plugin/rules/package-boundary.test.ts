import { test } from '@study/testing';

import { lintRule, root } from '../test/utils.ts';

test.unit.stable(
  'the database testing entry owns fixtures without allowing production testing dependencies',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'packages/db/src/testing.ts':
          "import { temporaryDirectory } from '@study/testing/resources';",
        'packages/db/src/db.ts': "import { temporaryDirectory } from '@study/testing/resources';"
      },
      true
    );

    expect(diagnostics.map(({ filename }) => filename.split('/').at(-1))).toEqual(['db.ts']);
  }
);

test.unit.stable(
  'package ownership, public exports, and browser entrypoints are enforced',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'packages/ui/src/app.ts': "import '@study/client';\n",
        'packages/ui/src/bad.ts': "import '@study/server/client';\n",
        'packages/localization/src/bad.ts': "export * from '@study/ui';\n",
        'packages/db/src/bad.ts': "import type { Account } from '@study/ai';\n",
        'packages/ai/src/bad.ts': "export * from '@study/db';\n",
        'apps/server/src/bad.ts': "import '@study/ui';\n",
        'apps/client/src/bad.ts': "export * from '@study/server/runtime';\n",
        'apps/client/src/root.ts': "import '@study/server';\n",
        'apps/client/src/node.ts': "import 'node:fs';\n",
        'apps/client/src/private.ts': "import '@study/server/shared/not-exported';\n",
        'apps/client/src/relative.ts': "export * from '../../../apps/server/src/index.ts';\n",
        'apps/client/src/absolute.ts': `import '${root}packages/ai/src/index.ts';\n`,
        'apps/client/src/dynamic.ts':
          "export const db = import('../../../packages/db/src/index.ts');\n",
        'apps/desktop/src/bad.ts': "import '@study/server/client';\n",
        'apps/landing/src/bad.ts': "import '@study/server/client';\n",
        'apps/landing/src/good.ts': "import '@study/ui';\nimport '@study/localization';\n",
        'tooling/scripts/seed/index.ts': "import '@study/localization';\n",
        'packages/ai/src/good.ts': "import '@study/localization';\n",
        'apps/server/src/good.ts': "import type { jobs } from '@study/db';\n",
        'apps/client/src/good.ts': "import '@study/ui';\nimport '@study/server/client';\n",
        'packages/ui/src/same.ts': "import './other.ts';\n"
      },
      true
    );

    expect(
      diagnostics
        .map(({ code, filename, message }) => {
          assert.strictEqual(code, 'study(package-boundary)');

          return [filename.split('/').slice(-4).join('/'), message];
        })
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    ).toStrictEqual(
      [
        ['packages/ui/src/app.ts', '@study/client is not a public package export.'],
        [
          'packages/ui/src/bad.ts',
          '@study/ui cannot depend on @study/server; use its owning layer.'
        ],
        [
          'packages/localization/src/bad.ts',
          '@study/localization cannot depend on @study/ui; use its owning layer.'
        ],
        ['packages/db/src/bad.ts', '@study/ai is not a public package export.'],
        ['packages/ai/src/bad.ts', '@study/ai cannot depend on @study/db; use its owning layer.'],
        [
          'apps/server/src/bad.ts',
          '@study/server cannot depend on @study/ui; use its owning layer.'
        ],
        [
          'apps/client/src/bad.ts',
          '@study/client cannot depend on @study/server; use its owning layer.'
        ],
        ['apps/client/src/root.ts', '@study/server is not a public package export.'],
        ['apps/client/src/node.ts', '@study/client cannot import Node builtins in browser code.'],
        [
          'apps/client/src/private.ts',
          '@study/server/shared/not-exported is not a public package export.'
        ],
        [
          'apps/client/src/relative.ts',
          'Import @study/server through its public package exports instead of a source path.'
        ],
        [
          'apps/client/src/absolute.ts',
          'Import @study/ai through its public package exports instead of a source path.'
        ],
        [
          'apps/client/src/dynamic.ts',
          'Import @study/db through its public package exports instead of a source path.'
        ],
        [
          'apps/desktop/src/bad.ts',
          '@study/desktop cannot depend on @study/server; use its owning layer.'
        ],
        [
          'apps/landing/src/bad.ts',
          'study-landing cannot depend on @study/server; use its owning layer.'
        ]
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    );
  }
);

test.unit.stable(
  'source and test directory imports cannot bypass package boundaries',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'apps/client/src/relative.ts': "import '../../../apps/server/src/';\n",
        'apps/client/src/absolute.ts': `import '${root}packages/db/test';\n`
      },
      true
    );

    expect(
      diagnostics
        .map(({ code, filename, message }) => {
          assert.strictEqual(code, 'study(package-boundary)');

          return [filename.split('/').at(-1), message];
        })
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    ).toStrictEqual([
      [
        'absolute.ts',
        'Import @study/db through its public package exports instead of a source path.'
      ],
      [
        'relative.ts',
        'Import @study/server through its public package exports instead of a source path.'
      ]
    ]);
  }
);

test.unit.stable(
  'the client build config can read test policy without exposing it to app code',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'apps/client/vite.config.ts': "import { testPolicy } from '@study/testing';",
        'apps/client/src/application.ts': "import { testPolicy } from '@study/testing';"
      },
      true
    );

    expect(diagnostics.map(({ filename }) => filename.split('/').at(-1))).toEqual([
      'application.ts'
    ]);
  }
);

test.unit.stable(
  'browser source forbids Node builtins but colocated tests and support may use them',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'apps/client/src/example.test.ts': "import 'node:assert/strict';\n",
        'packages/ui/src/example.test.tsx': "import 'node:fs';\n",
        'apps/client/src/test-support/helper.ts': "import 'node:fs';\n",
        'apps/client/src/test/helper.ts': "import 'node:fs';\n",
        'packages/ui/src/__tests__/helper.ts': "import 'node:fs';\n",
        'apps/client/src/example.ts': "import 'node:fs';\n"
      },
      true
    );

    expect(
      diagnostics.map(({ code, filename, message }) => {
        assert.strictEqual(code, 'study(package-boundary)');

        return [filename.split('/').at(-1), message];
      })
    ).toStrictEqual([['example.ts', '@study/client cannot import Node builtins in browser code.']]);
  }
);

test.unit.stable(
  'manifest exports honor blocked exact and more specific patterns and conditional root',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'apps/client/src/blocked.ts': "import '@study/ui/private';\n",
        'apps/client/src/pattern.ts': "import '@study/ui/internal/secret';\n",
        'apps/client/src/conditional.ts': "import '@study/ui/conditional';\n",
        'apps/client/src/good.ts':
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

    expect(
      diagnostics
        .map(({ code, filename, message }) => {
          assert.strictEqual(code, 'study(package-boundary)');

          return [filename.split('/').at(-1), message];
        })
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    ).toStrictEqual([
      ['blocked.ts', '@study/ui/private is not a public package export.'],
      ['conditional.ts', '@study/ui/conditional is not a public package export.'],
      ['pattern.ts', '@study/ui/internal/secret is not a public package export.']
    ]);
  }
);

test.unit.stable(
  'the theme engine remains browser-safe while UI and server can consume its public API',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'packages/theme/src/bad.ts':
          "import { readFileSync } from 'node:fs'; export { readFileSync };",
        'packages/ui/src/theme.ts': "export { parseTheme } from '@study/theme';",
        'apps/server/src/shared/themes/types.ts': "export type { ThemeFile } from '@study/theme';"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.match(diagnostics[0]!.message, /cannot import Node builtins/);
  }
);

test.unit.stable(
  'contracts are recognized and unknown workspace packages fail closed',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'packages/contracts/src/a.ts': "import type { A } from '@study/server';",
        'apps/server/src/a.ts':
          "import type { A } from '@study/contracts'; import '@study/ai'; import '@study/missing';",
        'apps/client/src/a.ts': "import '@study/server/shared/ids';"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'checks typed and aliased loader edges while honoring shadowing',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'apps/client/src/loader.ts': `import { createRequire as cr } from 'node:module';
const load = cr(import.meta.url);
load(\`@study/missing\`);
type T = import('@study/missing').T;
import x = require('@study/missing');
function f(require: (s: string) => void) { require('@study/missing');
}`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'loader edges follow lexical bindings and direct createRequire calls',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'apps/server/src/loader.ts': `import * as mod from 'node:module';
const cr = mod.createRequire;
const req = cr(import.meta.url);
const alias = req;
alias(\`@study/missing\`);
cr(import.meta.url)('@study/missing');
globalThis.require('@study/missing');
module.require('@study/missing');
const r = require;
r('@study/missing');
function f(globalThis: any, req: any) { globalThis.require('@study/missing');
req('@study/missing');
}`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'database storage may reuse canonical contract ID types without depending on server implementation',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'packages/db/src/schema/ids.ts':
          "import type { ProjectId } from '@study/contracts'; export type Id = ProjectId;",
        'packages/db/src/schema/server.ts':
          "import type { AppRouter } from '@study/server'; export type Router = AppRouter;"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics[0]?.filename.endsWith('/server.ts'));
  }
);

test.unit.stable(
  'landing consumes only the explicit feature preview export from client',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'apps/landing/src/good.ts':
          "export { FeaturePreview } from '@study/client/feature-previews';",
        'apps/landing/src/catalog.ts':
          "export { previewFeatures } from '@study/client/feature-previews/catalog';",
        'apps/landing/src/root.ts': "import '@study/client';",
        'apps/landing/src/private.ts': "import '@study/client/features/quiz';",
        'apps/landing/src/relative.ts': "import '../../client/src/feature-previews/index.tsx';"
      },
      true,
      {
        client: {
          './feature-previews': './src/feature-previews/index.tsx',
          './feature-previews/catalog': './src/feature-previews/catalog.ts',
          './features/quiz': './src/features/quiz/index.ts'
        }
      }
    );

    expect(diagnostics.map(({ filename }) => filename.split('/').at(-1)).sort()).toStrictEqual([
      'private.ts',
      'relative.ts',
      'root.ts'
    ]);
  }
);

test.unit.stable(
  'only explicit web E2E runtime harness files can own server resources',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'package-boundary',
      {
        'apps/client/test/e2e/harness/index.ts': `import '@study/db/testing';
 import '@study/server/runtime';
 import '@study/tooling/development/rpc-proxy';
`,
        'apps/client/test/e2e/harness/stack.ts':
          "import '@study/db/testing'; import '@study/server/runtime';",
        'apps/client/test/e2e/harness/testing.ts': "import '@study/server/testing';",
        'apps/client/test/e2e/harness/creation-response.test.ts': `import '@study/db/testing';
 import '@study/server/runtime';
 import '@study/tooling/development/rpc-proxy';
`,
        'apps/client/test/e2e/harness/other.test.ts':
          "import '@study/db/testing'; import '@study/server/runtime';",
        'apps/client/test/e2e/other.ts': `import '@study/db/testing';
 import '@study/server/runtime';
 import '@study/tooling/development/rpc-proxy';
`
      },
      true
    );

    expect(diagnostics.map(({ filename }) => filename.split('/').at(-1)).sort()).toStrictEqual([
      'other.test.ts',
      'other.test.ts',
      'other.ts',
      'other.ts',
      'other.ts'
    ]);
  }
);
