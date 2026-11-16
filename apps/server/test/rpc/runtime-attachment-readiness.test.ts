import { StudyRpc } from '@study/contracts';
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
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { Notes } from '#server/features/notes/index';
import { serve } from '#server/runtime/index';

test.stable(
  'HTTP attachment replies wake through registered source subscriptions before waiting for authentication',
  { timeout: 15000 },
  async ({ server: serverFixture, assert: assertions, pollUntil }) => {
    const assert: test.Assert = assertions;

    const fixture = serverFixture;
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

    function* verifyAttachmentReadinessWake({
      pollUntil,
      assert: assertions
    }: Pick<test.Context, 'pollUntil' | 'assert'>) {
      const assert: test.Assert = assertions;

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
      yield* pollUntil(
        Effect.gen(function* () {
          const executions = yield* client['workflows.executions']({
            correlationId: request.requestId,
            limit: 100
          });

          return executions.items.some(
            (execution) =>
              execution.workflow === 'conversation-reply/v1' && execution.status === 'suspended'
          );
        }),
        (value) => value,
        { attempts: 100, interval: '25 millis', message: 'Expected durable workflow wait' }
      );
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
      yield* pollUntil(
        Effect.sync(
          () =>
            fixture.store.db.orm.all(
              sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id = w.execution_id WHERE e.workflow_tag = 'conversation-reply/v1'`
            ).length > 0
        ),
        (value) => value,
        {
          attempts: 150,
          interval: '25 millis',
          message: 'the registered wake subscription must resume the actual dispatched reply'
        }
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

    await Effect.runPromise(
      Effect.scoped(Effect.gen(() => verifyAttachmentReadinessWake({ pollUntil, assert })))
    );
  }
);
