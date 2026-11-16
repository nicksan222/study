import { BunPath } from '@effect/platform-bun';
import { test } from '@study/testing';
import { Effect, Path } from 'effect';

import { header } from './file-description.ts';
import { lintFiles as lintSources, root } from './utils.ts';

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

// These fixtures exercise other policies; keep their module purposes documented.
const lintFiles: typeof lintSources = async (files, ...options) =>
  await lintSources(
    Object.fromEntries(
      Object.entries(files).map(([name, source]) => [name, header + '\n\n' + source])
    ),
    ...options
  );

test.stable(
  'whole import type remains enforced by built-in rules without a boundary false positive',
  async () => {
    const diagnostics = await lintFiles({
      'src/shared/inline-type.ts':
        "import { type Project } from '@study/contracts';\n\nexport type Entity = Project;\n"
    });

    test.assert.ok(diagnostics.length > 0);
    test.assert.ok(diagnostics.every(({ code }) => !code.includes('browser-boundary')));
    test.assert.ok(
      diagnostics.some(({ code }) => code.includes('consistent-type-specifier-style'))
    );
  }
);

test.stable(
  'server cross-directory imports use package aliases and sibling imports stay legal',
  async () => {
    const diagnostics = await lintFiles({
      'src/runtime/bad-import.ts':
        "import type { Value } from '../shared/safe.ts';\n\nexport type Next = Value;\n",
      'src/runtime/bad-export.ts': "export * from '../shared/safe.ts';\n",
      'src/runtime/bad-dynamic.ts': "export const value = import('../shared/safe.ts');\n",
      'src/runtime/good-server.ts': "export { value } from '#server/shared/safe';\n",
      'test/good-testing.ts': "export { helper } from '#testing/procedures';\n",
      'src/shared/safe.ts': 'export const value = 1;\n\nexport type Value = number;\n',
      'src/shared/sibling.ts': "export { value } from './safe.ts';\n"
    });

    test.assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
    test.assert.ok(diagnostics.every(({ code }) => code.includes('no-restricted-imports')));
  }
);

test.stable('Bun resolves package roots and explicit testing facets', () => {
  const result = test.spawnTestProcessSync(
    [
      process.execPath,
      '--eval',
      `
    for (const [specifier, suffix] of [
      ['@study/contracts', '/src/index.ts'],
      ['@study/db', '/src/index.ts'],
      ['@study/testing/vitest', '/src/vitest.ts']
    ]) {
      if (!Bun.fileURLToPath(import.meta.resolve(specifier)).endsWith(suffix)) throw new Error(specifier);
      await import(specifier);
    }
  `
    ],
    { cwd: join(root, 'apps/server') }
  );

  test.assert.strictEqual(result.exitCode, 0, result.stderr.toString() || result.stdout.toString());
});

test.stable(
  'server tests reject Node mock imports and context mocking through built-in rules',
  async () => {
    const diagnostics = await lintFiles({
      'test/mock-context.test.ts': String.raw`import { test } from "@study/testing";

test.stable("mocked method", (t) => {
  t.mock.method(Math, "random", () => 0.5);
});`,
      'test/mock-import.ts':
        "import { mock as tracker } from 'node:test';\n\nexport const mocking = tracker;\n",
      'test/mock-destructure.ts': String.raw`export function tracker(context: { mock: unknown }) {
  const { mock: tracker } = context;

  return tracker;
}`,
      'test/real.test.ts': String.raw`import { test } from "@study/testing";

test.stable("real value", (t) => {
  t.onTestFinished(() => {});
  test.assert.strictEqual(Math.max(1, 2), 2);
});`
    });

    test.assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
    test.assert.strictEqual(
      diagnostics.filter(({ code }) => code.includes('no-restricted-properties')).length,
      2
    );
    test.assert.strictEqual(
      diagnostics.filter(({ code }) => code.includes('no-restricted-imports')).length,
      1
    );
    test.assert.strictEqual(
      diagnostics.filter(({ code }) => code === 'study(test-classification)').length,
      1
    );
    test.assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/real.test.ts')));
  }
);

test.stable('server tests reject Vitest and Jest mocking imports', async () => {
  const diagnostics = await lintFiles({
    'test/vitest.ts': "export { vi as mocking } from 'vitest';\n",
    'test/vite-plus.ts': "export { vi as mocking } from 'vite-plus/test';\n",
    'test/jest.ts': "export { jest as mocking } from '@jest/globals';\n",
    'test/jest-mock.ts': "export { fn } from 'jest-mock';\n"
  });

  const restrictedImports = diagnostics.filter(({ code }) =>
    code.includes('no-restricted-imports')
  );

  test.assert.strictEqual(restrictedImports.length, 4, JSON.stringify(diagnostics));
  test.assert.ok(
    diagnostics.every(
      ({ code }) =>
        code.includes('no-restricted-imports') ||
        code.includes('prefer-vite-plus-imports') ||
        code === 'study(server-no-mocks)'
    )
  );
});

test.stable('production config loads the Study plugin', async () => {
  const diagnostics = await lintFiles({
    'src/shared/boundary-smoke.ts': "export * from '#server/runtime/context';\n"
  });

  test.assert.ok(
    diagnostics.some(
      ({ code, filename }) =>
        code === 'study(browser-boundary)' && filename.endsWith('/src/shared/boundary-smoke.ts')
    )
  );
});

test.stable('production config enforces package boundaries', async () => {
  const diagnostics = await lintFiles({
    'src/package-smoke.ts': "import '@study/ui';\n"
  });

  test.assert.ok(
    diagnostics.some(
      ({ code, filename }) =>
        code === 'study(package-boundary)' && filename.endsWith('/src/package-smoke.ts')
    )
  );
});

test.stable('production config enforces database ownership', async () => {
  const diagnostics = await lintFiles({
    'src/database-smoke.ts': "import { DatabaseSync } from 'node:sqlite';\n"
  });

  test.assert.ok(diagnostics.some(({ code }) => code === 'study(database-ownership)'));
});

test.stable(
  'production config rejects direct Drizzle imports outside the database package',
  async () => {
    const diagnostics = await lintFiles({
      'src/drizzle-smoke.ts': "import { sql } from 'drizzle-orm'; export { sql };"
    });

    test.assert.ok(diagnostics.some(({ code }) => code === 'study(drizzle-boundary)'));
  }
);

test.stable('future contracts subpaths are checked against explicit manifest exports', async () => {
  const diagnostics = await lintFiles(
    {
      'src/domains/projects/schema.ts':
        "export { projectSchema } from '@study/contracts/projects';",
      'src/domains/sources/schema.ts': "export { privateSchema } from '@study/contracts/private';"
    },
    'package-boundary',
    false,
    { contracts: { '.': './src/index.ts', './projects': './src/projects.ts' } }
  );

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  test.assert.ok(diagnostics[0]?.filename.endsWith('/src/domains/sources/schema.ts'));
});

test.stable(
  'production config enables feature orchestration, native clock and metric cardinality',
  async () => {
    const diagnostics = await lintFiles({
      'src/features/example/service.ts': String.raw`import { Metric } from "effect";
async function operation() {}
Date.now();
Metric.withAttributes({ requestId: "id" });`
    });

    for (const rule of ['feature-orchestration', 'native-clock', 'metric-cardinality'])
      test.assert.ok(
        diagnostics.some(({ code }) => code === `study(${rule})`),
        rule
      );
  }
);

test.stable(
  'Vitest expectations accept a diagnostic message and reject a third argument',
  async () => {
    const accepted = await lintFiles({
      'src/shared/message.test.ts': String.raw`import { test } from "@study/testing";
test.stable("message", () => {
  test.expect(1, "context").toBe(1);
});`
    });

    test.assert.strictEqual(accepted.length, 0, JSON.stringify(accepted));
    const rejected = await lintFiles({
      'src/shared/message.test.ts': String.raw`import { test } from "@study/testing";
test.stable("message", () => {
  test.expect(1, "context", "extra").toBe(1);
});`
    });

    test.assert.strictEqual(rejected.length, 1, JSON.stringify(rejected));
    test.assert.strictEqual(rejected[0]?.code, 'study(test-infrastructure)');
  }
);
