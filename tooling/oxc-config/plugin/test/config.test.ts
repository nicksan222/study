import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { header } from './file-description.ts';
import { lintFiles as lintSources, root } from './utils.ts';

// These fixtures exercise other policies; keep their module guides valid.
const lintFiles: typeof lintSources = (files, ...options) =>
  lintSources(
    Object.fromEntries(
      Object.entries(files).map(([name, source]) => [name, header + '\n\n' + source])
    ),
    ...options
  );

testStable(
  'whole import type remains enforced by built-in rules without a boundary false positive',
  () => {
    const diagnostics = lintFiles({
      'src/shared/inline-type.ts':
        "import { type Project } from '@study/contracts';\n\nexport type Entity = Project;\n"
    });

    assert.ok(diagnostics.length > 0);
    assert.ok(diagnostics.every(({ code }) => !code.includes('browser-boundary')));
    assert.ok(diagnostics.some(({ code }) => code.includes('consistent-type-specifier-style')));
  }
);

testStable(
  'server cross-directory imports use package aliases and sibling imports stay legal',
  () => {
    const diagnostics = lintFiles({
      'src/runtime/bad-import.ts':
        "import type { Value } from '../shared/safe.ts';\n\nexport type Next = Value;\n",
      'src/runtime/bad-export.ts': "export * from '../shared/safe.ts';\n",
      'src/runtime/bad-dynamic.ts': "export const value = import('../shared/safe.ts');\n",
      'src/runtime/good-server.ts': "export { value } from '#server/shared/safe';\n",
      'test/good-testing.ts': "export { helper } from '#testing/procedures';\n",
      'src/shared/safe.ts': 'export const value = 1;\n\nexport type Value = number;\n',
      'src/shared/sibling.ts': "export { value } from './safe.ts';\n"
    });

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ code }) => code.includes('no-restricted-imports')));
  }
);

testStable('Node resolves and loads extensionless nested server and testing aliases', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import { fileURLToPath } from 'node:url';
    for (const [specifier, suffix] of [
      ['@study/contracts/json', '/src/json.ts'],
      ['@study/contracts/errors', '/src/errors.ts'],
      ['#testing/automatic', '/test/testing/automatic.ts']
    ]) {
      if (!fileURLToPath(import.meta.resolve(specifier)).endsWith(suffix)) throw new Error(specifier);
      if (!specifier.startsWith('#testing/')) await import(specifier);
    }
  `
    ],
    { cwd: join(root, 'apps/server'), encoding: 'utf8' }
  );

  assert.isUndefined(result.error);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
});

testStable(
  'server tests reject Node mock imports and context mocking through built-in rules',
  () => {
    const diagnostics = lintFiles({
      'test/mock-context.test.ts':
        "import { testStable } from '@study/testing/vitest';\n\ntestStable('mocked method', (t) => { t.mock.method(Math, 'random', () => 0.5); });\n",
      'test/mock-import.ts':
        "import { mock as tracker } from 'node:test';\n\nexport const mocking = tracker;\n",
      'test/mock-destructure.ts':
        'export function tracker(context: { mock: unknown }) { const { mock: tracker } = context;\n\nreturn tracker; }\n',
      'test/real.test.ts':
        "import { assert } from 'vite-plus/test';\nimport { testStable } from '@study/testing/vitest';\n\ntestStable('real value', (t) => { t.onTestFinished(() => {}); assert.strictEqual(Math.max(1, 2), 2); });\n"
    });

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
    assert.strictEqual(
      diagnostics.filter(({ code }) => code.includes('no-restricted-properties')).length,
      2
    );
    assert.strictEqual(
      diagnostics.filter(({ code }) => code.includes('no-restricted-imports')).length,
      1
    );
    assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/real.test.ts')));
  }
);

testStable('server tests reject Vitest and Jest mocking imports', () => {
  const diagnostics = lintFiles({
    'test/vitest.ts': "export { vi as mocking } from 'vitest';\n",
    'test/vite-plus.ts': "export { vi as mocking } from 'vite-plus/test';\n",
    'test/jest.ts': "export { jest as mocking } from '@jest/globals';\n",
    'test/jest-mock.ts': "export { fn } from 'jest-mock';\n"
  });

  const restrictedImports = diagnostics.filter(({ code }) =>
    code.includes('no-restricted-imports')
  );

  assert.strictEqual(restrictedImports.length, 4, JSON.stringify(diagnostics));
  assert.ok(
    diagnostics.every(
      ({ code }) =>
        code.includes('no-restricted-imports') ||
        code.includes('prefer-vite-plus-imports') ||
        code === 'study(server-no-mocks)'
    )
  );
});

testStable('production config loads the Study plugin', () => {
  const diagnostics = lintFiles({
    'src/shared/boundary-smoke.ts': "export * from '#server/runtime/context';\n"
  });

  assert.ok(
    diagnostics.some(
      ({ code, filename }) =>
        code === 'study(browser-boundary)' && filename.endsWith('/src/shared/boundary-smoke.ts')
    )
  );
});

testStable('production config enforces package boundaries', () => {
  const diagnostics = lintFiles({
    'src/package-smoke.ts': "import '@study/ui/button';\n"
  });

  assert.ok(
    diagnostics.some(
      ({ code, filename }) =>
        code === 'study(package-boundary)' && filename.endsWith('/src/package-smoke.ts')
    )
  );
});

testStable('production config enforces database ownership', () => {
  const diagnostics = lintFiles({
    'src/database-smoke.ts': "import { DatabaseSync } from 'node:sqlite';\n"
  });

  assert.ok(diagnostics.some(({ code }) => code === 'study(database-ownership)'));
});

testStable('Effect v4 rejects obsolete package paths in global and server config', () => {
  const diagnostics = lintFiles(
    {
      'apps/server/src/old.ts': "export * from '@effect/platform/HttpClient';\n",
      'packages/ai/src/old.ts': "export * from 'effect/unstable/http';\n",
      'apps/web/src/old.ts': "export const old = import('@effect/rpc');\n",
      'packages/ai/src/modern.ts':
        "export * from 'effect/http';\nexport * from '@effect/platform-node';\n"
    },
    undefined,
    true
  );
  const restricted = diagnostics.filter(({ code }) => code.includes('no-restricted-imports'));

  assert.strictEqual(restricted.length, 3, JSON.stringify(diagnostics));
  assert.ok(restricted.some(({ filename }) => filename.endsWith('/apps/server/src/old.ts')));
  assert.ok(restricted.some(({ filename }) => filename.endsWith('/packages/ai/src/old.ts')));
  assert.ok(restricted.some(({ filename }) => filename.endsWith('/apps/web/src/old.ts')));
  assert.ok(restricted.every(({ filename }) => !filename.endsWith('/modern.ts')));
});

testStable('production config enables Effect v4 renamed API guard', () => {
  const diagnostics = lintFiles({
    'src/old-effect.ts': "import { Effect } from 'effect';\n\nexport const old = Effect.catchAll;\n"
  });

  assert.ok(
    diagnostics.some(({ code }) => code === 'study(effect-v4-api)'),
    JSON.stringify(diagnostics)
  );
});

testStable('production config rejects direct Drizzle imports outside the database package', () => {
  const diagnostics = lintFiles({
    'src/drizzle-smoke.ts': "import { sql } from 'drizzle-orm'; export { sql };"
  });

  assert.ok(diagnostics.some(({ code }) => code === 'study(drizzle-boundary)'));
});

testStable('the database package alone owns Drizzle dependencies', async () => {
  const { readdirSync, readFileSync, existsSync } = await import('node:fs');
  const manifests = [join(root, 'package.json')];

  for (const folder of ['apps', 'packages']) {
    for (const entry of readdirSync(join(root, folder))) {
      const file = join(root, folder, entry, 'package.json');

      if (existsSync(file)) manifests.push(file);
    }
  }

  for (const file of manifests) {
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies
    };

    if (manifest.name === '@study/db') {
      assert.ok(dependencies['drizzle-orm']);
      continue;
    }

    for (const name of Object.keys(dependencies))
      assert.ok(
        !/^drizzle-(?:orm|kit)(?:\/|$)/.test(name),
        `${manifest.name} must use @study/db instead of ${name}`
      );
  }
});

testStable('future contracts subpaths are checked against explicit manifest exports', () => {
  const diagnostics = lintFiles(
    {
      'src/domains/projects/schema.ts':
        "export { projectSchema } from '@study/contracts/projects';",
      'src/domains/sources/schema.ts': "export { privateSchema } from '@study/contracts/private';"
    },
    'package-boundary',
    false,
    { contracts: { '.': './src/index.ts', './projects': './src/projects.ts' } }
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics[0]?.filename.endsWith('/src/domains/sources/schema.ts'));
});

testStable(
  'production config enables feature orchestration, native clock and metric cardinality',
  () => {
    const diagnostics = lintFiles({
      'src/features/example/service.ts':
        "import { Metric } from 'effect'; async function operation() {} Date.now(); Metric.withAttributes({ requestId: 'id' });"
    });

    for (const rule of ['feature-orchestration', 'native-clock', 'metric-cardinality'])
      assert.ok(
        diagnostics.some(({ code }) => code === `study(${rule})`),
        rule
      );
  }
);

testStable('Vitest expectations accept a diagnostic message and reject a third argument', () => {
  const accepted = lintFiles({
    'src/shared/message.test.ts':
      "import { testStable } from '@study/testing/vitest'; import { expect } from 'vite-plus/test'; testStable('message', () => { expect(1, 'context').toBe(1); });"
  });

  assert.strictEqual(accepted.length, 0, JSON.stringify(accepted));
  const rejected = lintFiles({
    'src/shared/message.test.ts':
      "import { testStable } from '@study/testing/vitest'; import { expect } from 'vite-plus/test'; testStable('message', () => { expect(1, 'context', 'extra').toBe(1); });"
  });

  assert.strictEqual(rejected.length, 1, JSON.stringify(rejected));
  assert.strictEqual(rejected[0]?.code, 'vitest(valid-expect)');
});
