import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRule, lintRulePaths } from '../test/utils.ts';

async function lint(files: Record<string, string>) {
  const sources = Object.fromEntries(
    Object.entries(files).map(([path, source]) => [
      path,
      `import type { Db } from '@study/db'; declare const db: Db;
${source}`
    ])
  );

  return await lintRulePaths('workflow-persistence-boundary', sources);
}

testStable(
  'only progress persistence and retirement cleanup may write generation previews',
  async () => {
    expect(
      await lint({
        'apps/server/src/platform/workflows/agent-progress.ts': `import { workflow_agent_progress } from '@study/db/schema'; db.insert(workflow_agent_progress); db.update(workflow_agent_progress);`,
        'apps/server/src/platform/workflows/store.ts': `import { workflow_agent_progress } from '@study/db/schema'; db.delete(workflow_agent_progress);`,
        'apps/server/src/features/notes/store/index.ts': `import { workflow_agent_progress } from '@study/db/schema'; db.insert(workflow_agent_progress);`,
        'apps/server/src/platform/ai/agents.ts': `import { workflow_agent_progress } from '@study/db/schema'; db.update(workflow_agent_progress);`
      })
    ).toStrictEqual([
      'apps/server/src/features/notes/store/index.ts',
      'apps/server/src/platform/ai/agents.ts'
    ]);
  }
);

testStable(
  'restricts workflow table mutations to their exact owners while allowing reads',
  async () => {
    expect(
      await lint({
        'apps/server/src/features/workflows/store.ts': `import { workflow_executions as executions, workflowEvents } from '@study/db/schema'; db.select().from(executions); db.update(executions).set({}); db.insert(workflowEvents).values({});`,
        'apps/server/src/platform/workflows/store.ts': `import { workflow_executions, workflow_agent_progress } from '@study/db'; db.insert(workflow_executions); db.delete(workflow_agent_progress);`,
        'apps/server/src/platform/workflows/control.ts': `import { workflow_executions } from '@study/db'; db.delete(workflow_executions);`,
        'apps/server/src/platform/workflows/triggers.ts': `import { workflow_executions, workflowReceipts } from '@study/db/schema'; db.insert(workflow_executions); db.insert(workflowReceipts);`,
        'apps/server/src/platform/workflows/events.ts': `import { workflowEvents } from '@study/db/schema'; db.insert(workflowEvents);`,
        'apps/server/src/platform/workflows/retry.ts': `import { workflow_configuration_waits } from '@study/db/schema'; db.insert(workflow_configuration_waits);`,
        'apps/server/src/platform/workflows/configuration.ts': `import { workflow_configuration_waits } from '@study/db/schema'; db.delete(workflow_configuration_waits);`,
        'apps/server/src/feature.test.ts': `import { workflow_executions } from '@study/db/schema'; db.delete(workflow_executions);`
      })
    ).toStrictEqual([
      'apps/server/src/features/workflows/store.ts',
      'apps/server/src/features/workflows/store.ts',
      'apps/server/src/platform/workflows/control.ts'
    ]);
  }
);

testStable(
  'resolves imported tables through aliases, destructuring, wrappers and lexical scopes',
  async () => {
    expect(
      await lint({
        'apps/server/src/features/jobs/store.ts': `
      import * as schema from '@study/db/schema';
      import { workflowReceipts as clocks } from '@study/db';
      const ns = schema; const { workflow_agent_progress: activities } = ns;
      const alias = (activities as any)!; db.insert(alias); db.update(ns['workflow_configuration_waits']);
      db.delete(clocks satisfies unknown); function shadow(clocks) { db.delete(clocks); }
      const a = b; const b = a; db.insert(a);
      db.insert(schema.ordinary).onConflictDoUpdate({ target: schema.ordinary });
    `
      })
    ).toStrictEqual(Array(3).fill('apps/server/src/features/jobs/store.ts'));
  }
);

testStable('recognizes raw SQL writes without treating reads or values as mutations', async () => {
  expect(
    await lint({
      'apps/server/src/features/jobs/store.ts': `
      import { sql as query } from 'drizzle-orm';
      import * as schema from '@study/db/schema';
      const q = query;
      q\`UPDATE "workflow_executions" SET status = 'ok'\`;
      q\`/* comment */ INSERT OR IGNORE INTO [workflow_agent_progress] VALUES (1)\`;
      q\`SELECT 1; -- comment\n DELETE FROM \\\`workflow_receipts\\\` WHERE id = 1\`;
      q\`UPDATE \${schema.workflow_configuration_waits} SET value = 1\`;
      q.raw('DELETE FROM workflow_receipts WHERE id = 1');
      db.execute('INSERT INTO workflow_events VALUES (1)');
      q\`SELECT * FROM \${schema.workflow_executions}\`;
      q\`INSERT INTO ordinary VALUES ('UPDATE workflow_executions SET x=1') ON CONFLICT DO UPDATE SET x=1\`;
      db.execute("SELECT 'DELETE FROM workflow_receipts'");
      db.execute('SELECT "update" workflow_executions FROM ordinary');
    `
    })
  ).toStrictEqual(Array(6).fill('apps/server/src/features/jobs/store.ts'));
});

testStable('each protected table is restricted to its mapped owners', async () => {
  expect(
    await lint({
      'apps/server/src/platform/workflows/engine.ts': `import { workflow_agent_progress, workflow_configuration_waits, workflowReceipts } from '@study/db/schema'; db.insert(workflow_agent_progress); db.update(workflow_configuration_waits); db.delete(workflowReceipts); db.insert(workflow_configuration_waits); db.insert(workflowReceipts);`,
      'apps/server/src/platform/workflows/store.ts': `import { workflow_agent_progress, workflow_executions } from '@study/db/schema'; db.delete(workflow_agent_progress); db.update(workflow_executions);`,
      'apps/server/src/platform/workflows/events.ts': `import { workflow_executions } from '@study/db/schema'; db.insert(workflow_executions);`
    })
  ).toStrictEqual([
    ...Array(5).fill('apps/server/src/platform/workflows/engine.ts'),
    'apps/server/src/platform/workflows/events.ts'
  ]);
});

testStable('unrelated APIs and SQL identifiers are not workflow writers', async () => {
  expect(
    await lint({
      'apps/server/src/features/example/store.ts': `
      import { workflow_executions } from '@study/db';
      logger.update(workflow_executions);
      parser.run('UPDATE workflow_executions SET x=1');
      db.execute('SELECT update, workflow_executions FROM ordinary');
      db.execute('WITH update AS (SELECT 1) SELECT workflow_executions FROM ordinary');
      function shadow(db: { update(value: unknown): void }) { db.update(workflow_executions); }
    `
    })
  ).toStrictEqual([]);
});

for (const identifier of ['constructor', '__proto__', 'ordinary']) {
  for (const statement of [
    `WITH ${identifier} AS (SELECT 1) DELETE FROM workflow_events WHERE id = 1`,
    `SELECT ${identifier} FROM ordinary; DELETE FROM workflow_events WHERE id = 1`
  ]) {
    testStable(`detects protected SQL writes after ${statement}`, async () => {
      const diagnostics = await lintRule('workflow-persistence-boundary', {
        'apps/server/src/features/jobs/store.ts': `import type { Db } from '@study/db'; declare const db: Db; db.execute(${JSON.stringify(statement)});`
      });

      expect(diagnostics.map(({ message }) => message)).toStrictEqual([
        'Only the canonical workflow owner may write workflow_events.'
      ]);
    });
  }
}

testStable(
  'retirement may write its fences but progress and event mutations retain existing canonical owners',
  async () => {
    expect(
      await lint({
        'apps/server/src/platform/workflows/retirement.ts': `
      import * as s from '@study/db/schema';
      db.insert(s.workflow_retired_correlations); db.insert(s.workflow_retired_executions);
      db.delete(s.workflow_agent_progress); db.update(s.workflow_executions); db.update(s.workflowEvents);
    `,
        'apps/server/src/features/notes/store/deletion.ts': `
      import * as s from '@study/db/schema';
      db.insert(s.workflow_retired_correlations); db.insert(s.workflow_retired_executions);
    `,
        'apps/server/src/platform/workflows/control.ts': `
      import { sql } from '@study/db';
      sql\`DELETE FROM workflow_retired_executions WHERE execution_id=\${id}\`;
    `,
        'apps/server/src/platform/workflows/store.ts': `import * as s from '@study/db/schema'; db.delete(s.workflow_agent_progress); db.update(s.workflow_executions);`,
        'apps/server/src/platform/workflows/events.ts': `import * as s from '@study/db/schema'; db.update(s.workflowEvents);`,
        'apps/server/src/platform/workflows/configuration.ts': `import * as s from '@study/db/schema'; db.delete(s.workflow_configuration_waits);`
      })
    ).toStrictEqual([
      ...Array(2).fill('apps/server/src/features/notes/store/deletion.ts'),
      'apps/server/src/platform/workflows/control.ts',
      ...Array(3).fill('apps/server/src/platform/workflows/retirement.ts')
    ]);
  }
);

testStable(
  'Material cleanup cannot acquire domain execution, progress, event or fence writer authority',
  async () => {
    expect(
      await lint({
        'apps/server/src/features/materials/store/deletion.ts': `
      import * as s from '@study/db/schema';
      import { sql } from '@study/db';
      db.select().from(s.workflow_executions);
      db.update(s.workflow_executions); db.delete(s.workflow_agent_progress);
      db.delete(s.workflow_configuration_waits); db.delete(s.workflowReceipts);
      db.update(s.workflowEvents); db.delete(s.workflow_configuration_waits);
      db.insert(s.workflow_retired_correlations);
      sql\`DELETE FROM workflow_retired_executions WHERE correlation_id=\${id}\`;
    `,
        'apps/server/src/platform/workflows/retirement.ts': `
      import * as s from '@study/db/schema';
      db.insert(s.workflow_retired_correlations); db.insert(s.workflow_retired_executions);
    `
      })
    ).toStrictEqual(Array(8).fill('apps/server/src/features/materials/store/deletion.ts'));
  }
);

testStable(
  'history participants cannot mutate domain payloads, progress, waits or fences',
  async () => {
    expect(
      await lint({
        'apps/server/src/features/materials/store/generation-cleanup.ts': `
      import * as schema from '@study/db/schema';
      const { workflow_agent_progress: checkpoints, workflow_retired_executions: retired } = schema;

      db.delete(checkpoints); db.insert(retired); db.update(schema.workflow_executions);

    `,
        'apps/server/src/features/notes/store/material-history.ts': `
      import * as s from '@study/db/schema'; import { sql } from '@study/db';
      db.select().from(s.workflow_configuration_waits);

      db.delete(s.workflow_configuration_waits); db.delete(s.workflow_configuration_waits);

      sql\`DELETE FROM workflow_events WHERE correlation_id=\${requestId}\`;

    `,
        'apps/server/src/platform/workflows/retirement.ts': `
      import * as s from '@study/db/schema'; db.insert(s.workflow_retired_correlations); db.insert(s.workflow_retired_executions);
    `
      })
    ).toStrictEqual([
      ...Array(3).fill('apps/server/src/features/materials/store/generation-cleanup.ts'),
      ...Array(3).fill('apps/server/src/features/notes/store/material-history.ts')
    ]);
  }
);

testStable(
  'snapshot sanitizers cannot clear native payloads or receipts outside the canonical workflow owners',
  async () => {
    expect(
      await lint({
        'apps/server/src/features/system/store/backup.ts': `
      import * as s from '@study/db/schema'; import { sql } from '@study/db';
      db.select().from(s.workflow_executions);
      db.update(s.workflow_executions); db.delete(s.workflow_agent_progress);
      db.delete(s.workflowReceipts); db.delete(s.workflow_configuration_waits);
      sql\`UPDATE workflow_events SET payload='{}'\`;
    `,
        'apps/server/src/platform/database/backups.ts': `
      import * as s from '@study/db/schema'; db.delete(s.workflow_retired_executions);
    `
      })
    ).toStrictEqual([
      ...Array(5).fill('apps/server/src/features/system/store/backup.ts'),
      'apps/server/src/platform/database/backups.ts'
    ]);
  }
);

testStable('official SQL infrastructure has no first-party schema or writer owner', async () => {
  expect(
    await lint({
      'apps/server/src/platform/workflows/engine.ts': `import { sql } from '@study/db'; sql\`INSERT INTO cluster_messages VALUES (1)\`; sql.raw('UPDATE "cluster_replies" SET payload=1');`,
      'packages/db/src/custom.ts': `db.exec('CREATE TABLE cluster_messages(id TEXT)'); db.exec('ALTER TABLE main.cluster_replies ADD payload TEXT'); db.exec('DROP TABLE IF EXISTS cluster_migrations');`,
      'apps/server/src/features/jobs/store.ts': `db.exec('CREATE INDEX job_index ON cluster_messages(id)'); db.exec('CREATE TRIGGER private_write AFTER INSERT ON cluster_replies BEGIN SELECT 1; END');`,
      'packages/db/src/schema/custom.ts': `sqliteTable('cluster_messages', {}); defineTable({ role: 'internal' })('cluster_replies', {});`,
      'tooling/scripts/jobs.ts': `db.exec('DELETE FROM cluster_messages');`,
      'apps/server/src/platform/workflows/reader.ts': `db.exec('SELECT * FROM cluster_messages'); db.exec("SELECT 'DELETE FROM cluster_messages'");`
    })
  ).toStrictEqual([
    'apps/server/src/features/jobs/store.ts',
    'apps/server/src/features/jobs/store.ts',
    'apps/server/src/platform/workflows/engine.ts',
    'apps/server/src/platform/workflows/engine.ts',
    'packages/db/src/custom.ts',
    'packages/db/src/custom.ts',
    'packages/db/src/custom.ts',
    'packages/db/src/schema/custom.ts',
    'packages/db/src/schema/custom.ts',
    'tooling/scripts/jobs.ts'
  ]);
});

testStable('checks trigger body writes and created schema object names', async () => {
  expect(
    await lint({
      'apps/server/src/features/jobs/body.ts': `db.exec('CREATE TRIGGER audit AFTER INSERT ON notes BEGIN DELETE FROM cluster_messages; END;');`,
      'apps/server/src/features/jobs/index.ts': `db.exec('CREATE UNIQUE INDEX IF NOT EXISTS cluster_custom ON notes(updated_at)');`,
      'apps/server/src/features/jobs/trigger.ts': `db.exec('CREATE TEMP TRIGGER cluster_custom AFTER INSERT ON notes BEGIN SELECT 1; END;');`,
      'apps/server/src/features/jobs/allowed.ts': `db.exec("CREATE TRIGGER audit AFTER INSERT ON notes BEGIN SELECT 'DELETE FROM cluster_messages'; END;"); db.exec('CREATE INDEX note_updated ON notes(updated_at)');`
    })
  ).toStrictEqual([
    'apps/server/src/features/jobs/body.ts',
    'apps/server/src/features/jobs/index.ts',
    'apps/server/src/features/jobs/trigger.ts'
  ]);
});
