import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { root } from '../test/utils.ts';

function lint(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-rule-'));

  try {
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    writeFileSync(
      join(dir, 'plugin.mjs'),
      `import { definePlugin } from 'vite-plus/lint/plugins';\nimport rules from ${JSON.stringify(join(root, 'tooling/oxc-config/plugin/persistence-rules.ts'))};\nexport default definePlugin({ meta: { name: 'study' }, rules });`
    );
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        jsPlugins: [{ name: 'study', specifier: join(dir, 'plugin.mjs') }],
        categories: { correctness: 'off' },
        rules: { 'study/workflow-persistence-boundary': 'error' }
      })
    );

    for (const [path, source] of Object.entries(files)) {
      const file = join(dir, path);

      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `import type { Db } from '@study/db'; declare const db: Db;\n${source}`);
    }

    const result = spawnSync(
      join(root, 'node_modules/.bin/oxlint'),
      [
        '--config',
        join(dir, 'config.json'),
        '--no-ignore',
        '--format',
        'json',
        ...Object.keys(files).map((path) => join(dir, path))
      ],
      { encoding: 'utf8', cwd: root }
    );

    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);

    return (JSON.parse(result.stdout) as { diagnostics: { filename: string }[] }).diagnostics
      .map((d) => d.filename.slice(dir.length + 1))
      .sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('restricts workflow table mutations to their exact owners while allowing reads', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/workflows/store.ts': `import { workflow_executions as executions, workflowEvents } from '@study/db/schema'; db.select().from(executions); db.update(executions).set({}); db.insert(workflowEvents).values({});`,
      'apps/server/src/platform/workflows/store.ts': `import { workflow_executions, workflow_activities } from '@study/db'; db.insert(workflow_executions); db.delete(workflow_activities);`,
      'apps/server/src/platform/workflows/control.ts': `import { workflow_executions } from '@study/db'; db.delete(workflow_executions);`,
      'apps/server/src/platform/workflows/triggers.ts': `import { workflow_executions, workflowReceipts } from '@study/db/schema'; db.insert(workflow_executions); db.insert(workflowReceipts);`,
      'apps/server/src/platform/workflows/events.ts': `import { workflowEvents } from '@study/db/schema'; db.insert(workflowEvents);`,
      'apps/server/src/platform/workflows/retry.ts': `import { workflow_configuration_waits } from '@study/db/schema'; db.insert(workflow_configuration_waits);`,
      'apps/server/src/platform/workflows/configuration.ts': `import { workflow_configuration_waits } from '@study/db/schema'; db.delete(workflow_configuration_waits);`,
      'apps/server/src/feature.test.ts': `import { workflow_executions } from '@study/db/schema'; db.delete(workflow_executions);`
    }),
    [
      'apps/server/src/features/workflows/store.ts',
      'apps/server/src/features/workflows/store.ts',
      'apps/server/src/platform/workflows/control.ts'
    ]
  );
});

test('resolves imported tables through aliases, destructuring, wrappers and lexical scopes', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/jobs/store.ts': `
      import * as schema from '@study/db/schema';
      import { workflow_clocks as clocks } from '@study/db';
      const ns = schema; const { workflow_activities: activities } = ns;
      const alias = (activities as any)!; db.insert(alias); db.update(ns['workflow_deferreds']);
      db.delete(clocks satisfies unknown); function shadow(clocks) { db.delete(clocks); }
      const a = b; const b = a; db.insert(a);
      db.insert(schema.ordinary).onConflictDoUpdate({ target: schema.ordinary });
    `
    }),
    Array(3).fill('apps/server/src/features/jobs/store.ts')
  );
});

test('recognizes raw SQL writes without treating reads or values as mutations', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/jobs/store.ts': `
      import { sql as query } from 'drizzle-orm';
      import * as schema from '@study/db/schema';
      const q = query;
      q\`UPDATE "workflow_executions" SET status = 'ok'\`;
      q\`/* comment */ INSERT OR IGNORE INTO [workflow_activities] VALUES (1)\`;
      q\`SELECT 1; -- comment\n DELETE FROM \\\`workflow_clocks\\\` WHERE id = 1\`;
      q\`UPDATE \${schema.workflow_deferreds} SET value = 1\`;
      q.raw('DELETE FROM workflow_receipts WHERE id = 1');
      db.execute('INSERT INTO workflow_events VALUES (1)');
      q\`SELECT * FROM \${schema.workflow_executions}\`;
      q\`INSERT INTO ordinary VALUES ('UPDATE workflow_executions SET x=1') ON CONFLICT DO UPDATE SET x=1\`;
      db.execute("SELECT 'DELETE FROM workflow_receipts'");
      db.execute('SELECT "update" workflow_executions FROM ordinary');
    `
    }),
    Array(6).fill('apps/server/src/features/jobs/store.ts')
  );
});

test('each protected table is restricted to its mapped owners', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/platform/workflows/engine.ts': `import { workflow_activities, workflow_deferreds, workflow_clocks, workflow_configuration_waits, workflowReceipts } from '@study/db/schema'; db.insert(workflow_activities); db.update(workflow_deferreds); db.delete(workflow_clocks); db.insert(workflow_configuration_waits); db.insert(workflowReceipts);`,
      'apps/server/src/platform/workflows/store.ts': `import { workflow_deferreds, workflow_clocks } from '@study/db/schema'; db.insert(workflow_deferreds); db.update(workflow_clocks);`,
      'apps/server/src/platform/workflows/events.ts': `import { workflow_executions } from '@study/db/schema'; db.insert(workflow_executions);`
    }),
    [
      ...Array(5).fill('apps/server/src/platform/workflows/engine.ts'),
      'apps/server/src/platform/workflows/events.ts'
    ]
  );
});

test('unrelated APIs and SQL identifiers are not workflow writers', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/example/store.ts': `
      import { workflow_executions } from '@study/db';
      logger.update(workflow_executions);
      parser.run('UPDATE workflow_executions SET x=1');
      db.execute('SELECT update, workflow_executions FROM ordinary');
      db.execute('WITH update AS (SELECT 1) SELECT workflow_executions FROM ordinary');
      function shadow(db: { update(value: unknown): void }) { db.update(workflow_executions); }
    `
    }),
    []
  );
});
