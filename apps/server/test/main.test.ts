import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { createServerTest } from '#testing/server-test';

for (const shutdown of ['stdin EOF', 'SIGTERM'] as const) {
  test(
    `server entry serves native RPC and shuts down on ${shutdown}`,
    { timeout: 30_000 },
    async (t) => {
      const testDatabase = createServerTest(t, { app: false });
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        STUDY_DATABASE: testDatabase.path
      };

      delete env.STUDY_SERVER_TOKEN;
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('../src/runtime/main.ts', import.meta.url))],
        {
          env,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      );
      const exit = once(child, 'exit');

      testDatabase.dispose(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');

        await exit;
      });
      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      const lines = createInterface({ input: child.stdout });
      const stdout: string[] = [];

      lines.on('line', (line) => stdout.push(line));

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
        assert.deepEqual(Object.keys(endpoint), ['url']);
        const project = await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* makeStudyClient(StudyRpc, { baseUrl: endpoint.url });

              return yield* client['projects.createProject']({ name: 'Process persistence' });
            })
          )
        );

        assert.equal(typeof project.id, 'bigint');
        const database = createServerTest(t, { app: false }).openDb(env.STUDY_DATABASE!);

        try {
          const saved = database.orm.get<{ id: bigint; name: string }>(
            sql`SELECT id, name FROM projects WHERE id=${project.id}`
          );

          assert.equal(saved?.id, project.id);
          assert.equal(saved?.name, 'Process persistence');
        } finally {
          database.close();
        }

        if (shutdown === 'stdin EOF') child.stdin.end();
        else child.kill('SIGTERM');

        const result = await exit;

        assert.equal(result[0], 0, stderr);
        assert.deepEqual(stdout, [JSON.stringify(endpoint)]);
      } finally {
        lines.close();

        if (child.exitCode === null) child.kill('SIGKILL');

        await exit;
      }
    }
  );
}
