import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

const cases = [
  {
    rule: 'module-factories',
    path: 'src/features/example/rpc/index.ts',
    source: `import { defineRpc as create } from '@study/server';
const alias = create;
export const layer = alias(group, handlers);`,
    count: 0
  },
  {
    rule: 'synchronous-transactions',
    path: 'src/features/example/service/index.ts',
    source: `import { transaction as write } from '@study/server';
write(async () => 1);`,
    count: 1
  },
  {
    rule: 'server-layer-boundary',
    path: 'src/features/example/rpc/index.ts',
    source: `import { Database, defineRpc } from '@study/server';
import type { ServerContext } from '@study/server';`,
    count: 2
  },
  {
    rule: 'server-layer-boundary',
    path: 'src/features/example/service/index.ts',
    source: `import { Database as DB } from '@study/server';
const database = DB;
import type { ServerContext } from '@study/server';`,
    count: 1
  },
  {
    rule: 'ai-boundary',
    path: 'src/features/example/service/index.ts',
    source: `import { generateAgent as generate } from '@study/server';
const run = generate;
run(agent, input);`,
    count: 1
  },
  {
    rule: 'workflow-boundary',
    path: 'src/features/example/workflows/index.ts',
    source: `import { PublicationGuard as Guard } from '@study/server';
import { Layer } from 'effect';
Layer.succeed(Guard, {});`,
    count: 1
  },
  {
    rule: 'structured-logging',
    path: 'src/features/example/service/index.ts',
    source: `import { safeMetadata as safe } from '@study/server';
import { Effect } from 'effect';
Effect.annotateLogs(effect, safe(metadata));`,
    count: 0
  }
] as const;

for (const { rule, path, source, count } of cases)
  test.unit.stable(
    `server package preserves ${rule} in ${path}`,
    async ({ assert: assertions }) => {
      const assert: test.Assert = assertions;
      const diagnostics = await lintRule({ assert }, rule, { [path]: source });

      assert.strictEqual(diagnostics.length, count, JSON.stringify(diagnostics));
    }
  );

test.unit.stable(
  'server package import types preserve RPC capability boundaries',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;
    const diagnostics = await lintRule({ assert }, 'server-layer-boundary', {
      'src/features/example/rpc/index.ts': "type Context = import('@study/server').ServerContext;"
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'server package namespace store factories retain synchronous transactions',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;
    const diagnostics = await lintRule({ assert }, 'synchronous-transactions', {
      'src/features/example/store/index.ts': `import * as api from '@study/server';
api.defineStore({ make: ({ db }) => {
  db.transaction(async () => 1);
  return {};
} });`
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'server package aggregate imports cannot bypass RPC database boundaries',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    for (const source of [
      "const api = await import('@study/server');",
      "const api = require('@study/server');",
      "import api = require('@study/server');",
      "export * from '@study/server';"
    ]) {
      const diagnostics = await lintRule({ assert }, 'server-layer-boundary', {
        'src/features/example/rpc/index.ts': source
      });

      assert.ok(diagnostics.length > 0, source);
    }
  }
);

test.unit.stable(
  'aggregate server imports retain service database restrictions',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    for (const source of [
      "const { Database } = await import('@study/server');",
      "const { Database } = require('@study/server');"
    ]) {
      const diagnostics = await lintRule({ assert }, 'server-layer-boundary', {
        'src/features/example/service/index.ts': source
      });

      assert.ok(diagnostics.length > 0, source);
    }
  }
);

test.unit.stable(
  'quoted server reexports retain capability boundaries',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;
    const diagnostics = await lintRule({ assert }, 'server-layer-boundary', {
      'src/features/example/rpc/index.ts': `export { "ServerContext" as Context } from '@study/server';`
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);
