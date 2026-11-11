/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Recovers a pending reply after abrupt termination of the real Bun server.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies durable requests survive process termination without duplicate messages.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the production server entry, native RPC and an isolated SQLite database.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';

testStable(
  'a pending reply survives abrupt Bun server process death without duplicates',
  async () => {
    const location = await createTestDatabase();
    const children: ReturnType<typeof Bun.spawn<'pipe', 'pipe', 'pipe'>>[] = [];

    async function start() {
      const env: Record<string, string | undefined> = {
        ...process.env,
        STUDY_DATABASE: location.path
      };

      delete env.STUDY_SERVER_TOKEN;
      const child = Bun.spawn(
        [process.execPath, new URL('../src/runtime/main.ts', import.meta.url).pathname],
        {
          env,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe'
        }
      );

      children.push(child);
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let output = '';

      try {
        const deadline = AbortSignal.timeout(15000);

        while (!output.includes('\n')) {
          const chunk = await Promise.race([
            reader.read(),
            child.exited.then(async () => {
              throw new Error(await new Response(child.stderr).text());
            }),
            new Promise<never>((_, reject) =>
              deadline.addEventListener(
                'abort',
                () => reject(new Error('Server startup timed out')),
                { once: true }
              )
            )
          ]);

          if (chunk.done) throw new Error('Server closed stdout before reporting its endpoint');

          output += decoder.decode(chunk.value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }

      return { child, url: (JSON.parse(output.split('\n')[0]!) as { url: string }).url };
    }

    try {
      const first = await start();
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: first.url });
            const note = yield* client['notes.createNote']({ title: 'Crash recovery' });
            const input = {
              noteId: note.id,
              intentKey: 'crash-recovery',
              expectedSelectionRevision: 0n,
              text: 'Exact durable question'
            };
            const result = yield* client['notes.ask'](input);

            return { input, result };
          })
        )
      );

      await waitForReply(location);

      first.child.kill('SIGKILL');
      expect(await first.child.exited).not.toBe(0);
      const second = await start();

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: second.url });

            expect(yield* client['notes.ask'](saved.input)).toEqual(saved.result);
            expect(
              yield* client['notes.replyVersion']({
                noteId: saved.input.noteId,
                messageId: saved.result.messageId,
                versionId: saved.result.versionId
              })
            ).toEqual({ state: 'available', requestId: saved.result.requestId });
            const thread = yield* client['notes.thread']({ noteId: saved.input.noteId, limit: 10 });

            expect(thread.items).toHaveLength(2);
          })
        )
      );
    } finally {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');

        await child.exited;
      }

      await location.cleanup();
    }
  }
);

async function waitForReply(location: Awaited<ReturnType<typeof createTestDatabase>>) {
  const database = await location.open();

  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        database.orm.all(
          sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id=w.execution_id WHERE e.workflow_tag='conversation-reply/v1'`
        ).length === 1
      )
        return;

      await Bun.sleep(50);
    }

    throw new Error('Reply did not reach a durable configuration wait');
  } finally {
    database.close();
  }
}
