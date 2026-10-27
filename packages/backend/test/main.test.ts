import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createStudyClient } from '@study/backend/node';

for (const shutdown of ['stdin EOF', 'SIGTERM'] as const) {
  test(
    `backend entry serves real tRPC and shuts down on ${shutdown}`,
    { timeout: 30_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'study-process-'));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        STUDY_DATABASE: join(dir, 'db')
      };

      delete env.STUDY_BACKEND_TOKEN;
      const child = spawn(
        process.execPath,
        [new URL('../src/runtime/main.ts', import.meta.url).pathname],
        {
          env,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      );
      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      const lines = createInterface({ input: child.stdout });
      const exit = once(child, 'exit');

      try {
        const line = await Promise.race([
          once(lines, 'line'),
          exit.then(() => {
            throw new Error(stderr);
          })
        ]);
        const endpoint = JSON.parse(line[0] as string) as {
          url: string;
        };

        assert.match(endpoint.url, /^http:\/\/127\.0\.0\.1:/);
        const client = createStudyClient({
          baseUrl: endpoint.url
        });

        assert.deepEqual(Object.keys(endpoint), ['url']);
        const health = await client.system.getHealth.query();

        assert.equal(health.workersRunning, true);
        assert.equal(health.testMode, false);
        const project = await client.projects.createProject.mutate({
          name: 'Process persistence'
        });

        assert.equal(typeof project.id, 'bigint');
        const database = new DatabaseSync(env.STUDY_DATABASE!, {
          readOnly: true,
          readBigInts: true
        });

        try {
          const saved = database
            .prepare('SELECT id, name FROM projects WHERE id=?')
            .get(project.id);

          assert.equal(saved?.id, project.id);
          assert.equal(saved?.name, 'Process persistence');
        } finally {
          database.close();
        }

        if (shutdown === 'stdin EOF') child.stdin.end();
        else child.kill('SIGTERM');

        const result = await exit;

        assert.equal(result[0], 0, stderr);
      } finally {
        lines.close();

        if (child.exitCode === null) child.kill('SIGKILL');

        await exit;
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
}
