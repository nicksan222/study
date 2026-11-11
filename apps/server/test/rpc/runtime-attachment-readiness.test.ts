/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises an HTTP note reply with a source still downloading. It verifies          │
 * │ the registered attachment wake resumes the durable reply into its later authentication   │
 * │ wait.                                                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: HTTP attachment replies wake through registered source subscriptions before   │
 * │   waiting for authentication.                                                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/features/notes/index, #server/runtime/index           │
 * │ with real SQLite and application resources; fixture cleanup closes owned resources.      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { Notes } from '#server/features/notes/index';
import { serve } from '#server/runtime/index';
import { createStudyTest } from '#testing/server-test';

testStable(
  'HTTP attachment replies wake through registered source subscriptions before waiting for authentication',
  { timeout: 15000 },
  async (t) => {
    const fixture = await createStudyTest(t);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const peer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch() {
        await gate;

        return new Response('Captured alpha evidence', {
          headers: { 'content-type': 'text/plain' }
        });
      }
    });

    fixture.dispose(async () => {
      release();
      await peer.stop(true);
    });
    assert.ok(peer.port, 'missing source peer address');
    const evidenceUrl = new URL('/evidence.txt', peer.url).href;
    const server = fixture.manage(await serve(fixture.app));

    function* verifyAttachmentReadinessWake() {
      const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
      const project = yield* client['projects.createProject']({ name: 'Readiness' });
      const source = yield* client['sources.addLink']({
        projectId: project.id,
        url: evidenceUrl
      });
      const note = yield* client['notes.createNote']({
        project: project.id,
        title: 'Chat'
      });

      yield* client['notes.postMessage']({
        noteId: note.id,
        text: 'Explain the evidence',
        sourceIds: [source.id]
      });
      const request = yield* client['notes.requestReply']({ noteId: note.id });

      yield* client['system.startWorkers']({});
      let waiting = false;

      for (let i = 0; i < 100; i++) {
        const executions = yield* client['workflows.executions']({
          correlationId: request.requestId,
          limit: 100
        });

        if (
          executions.items.some(
            (execution) =>
              execution.workflow === 'conversation-reply/v1' && execution.status === 'suspended'
          )
        ) {
          waiting = true;
          break;
        }

        yield* Effect.sleep('25 millis');
      }

      assert.ok(waiting === true);
      assert.strictEqual(
        fixture.store.db.orm.all(
          sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id = w.execution_id WHERE e.workflow_tag = 'conversation-reply/v1'`
        ).length,
        0
      );
      const before = yield* Effect.promise(() =>
        fixture.run(
          Effect.flatMap(Notes, (notes) => notes.replySnapshot({ requestId: request.requestId }))
        )
      );

      assert.strictEqual(before.pendingAttachments?.length, 1);
      release();
      let authentication = false;

      for (let i = 0; i < 150; i++) {
        if (
          fixture.store.db.orm.all(
            sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id = w.execution_id WHERE e.workflow_tag = 'conversation-reply/v1'`
          ).length > 0
        ) {
          authentication = true;
          break;
        }

        yield* Effect.sleep('25 millis');
      }

      assert.ok(
        authentication === true,
        'the registered wake subscription must resume the actual dispatched reply'
      );
      const after = yield* Effect.promise(() =>
        fixture.run(
          Effect.flatMap(Notes, (notes) => notes.replySnapshot({ requestId: request.requestId }))
        )
      );

      assert.strictEqual(after.pendingAttachments, undefined);
      assert.strictEqual(after.messages[0]?.attachments[0]?.sourceId, source.id);
      assert.strictEqual(
        after.messages[0]?.attachments[0]?.snapshotId,
        (yield* client['sources.sourceProcessing']({ id: source.id })).documentId
      );
    }

    await Effect.runPromise(Effect.scoped(Effect.gen(verifyAttachmentReadinessWake)));
  }
);
