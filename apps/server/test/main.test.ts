/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Starts the real server entrypoint as a child process and verifies native RPC       │
 * │ writes durable project data. Both stdin EOF and SIGTERM must shut the process down       │
 * │ cleanly.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: server entry serves native RPC and shuts down on <shutdown>.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index with real SQLite and application resources; fixture cleanup    │
 * │ closes owned resources.                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { createServerTest } from '#testing/server-test';

for (const shutdown of ['stdin EOF', 'SIGTERM'] as const) {
  testStable(
    `server entry serves native RPC and shuts down on ${shutdown}`,
    { timeout: 30_000 },
    async (t) => {
      const testDatabase = createServerTest(t, { app: false });
      const env: Record<string, string | undefined> = {
        ...process.env,
        STUDY_DATABASE: testDatabase.path
      };

      delete env.STUDY_SERVER_TOKEN;
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          Bun.fileURLToPath(new URL('../src/runtime/main.ts', import.meta.url))
        ],
        env,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe'
      });
      const exit = child.exited;
      const stderr = new Response(child.stderr).text();
      const reader = child.stdout.getReader();
      const stdout: string[] = [];
      const decoder = new TextDecoder();
      let partial = '';
      const output = (async () => {
        for (;;) {
          const { value, done } = await reader.read();

          partial += decoder.decode(value, { stream: !done });
          const lines = partial.split('\n');

          partial = lines.pop()!;
          stdout.push(...lines);

          if (done) return;
        }
      })();

      testDatabase.dispose(async () => {
        if (child.exitCode === null) child.kill('SIGKILL');

        await exit;
      });

      try {
        while (stdout.length === 0 && child.exitCode === null) await Bun.sleep(10);

        assert.ok(stdout.length > 0, child.exitCode === null ? '' : await stderr);

        const line = stdout[0]!;
        const endpoint = JSON.parse(line) as {
          url: string;
        };

        expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
        expect(Object.keys(endpoint)).toStrictEqual(['url']);
        const project = await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* makeStudyClient(StudyRpc, { baseUrl: endpoint.url });

              return yield* client['projects.createProject']({ name: 'Process persistence' });
            })
          )
        );

        assert.ok(typeof project.id === 'bigint');
        const database = await createServerTest(t, { app: false }).openDb(env.STUDY_DATABASE!);

        try {
          const saved = database.orm.get<{ id: bigint; name: string }>(
            sql`SELECT id, name FROM projects WHERE id=${project.id}`
          );

          assert.strictEqual(saved?.id, project.id);
          assert.ok(saved?.name === 'Process persistence');
        } finally {
          database.close();
        }

        if (shutdown === 'stdin EOF') child.stdin.end();
        else child.kill('SIGTERM');

        const result = await exit;

        await output;
        assert.strictEqual(result, 0, await stderr);
        expect(stdout).toStrictEqual([JSON.stringify(endpoint)]);
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');

        await exit;
      }
    }
  );
}
