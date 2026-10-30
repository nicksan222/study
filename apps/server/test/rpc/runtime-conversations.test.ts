import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

test(
  'a reply requested over RPC reaches the durable sign-in wait',
  { timeout: 10000 },
  async () => {
    const location = createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);

    await app.workers.start();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const project = yield* client['projects.createProject']({ name: 'Conversation' });
            const session = yield* client['conversations.createSession']({
              project: project.id,
              title: 'Chat'
            });

            yield* client['conversations.postMessage']({
              sessionId: session.id,
              text: 'Explain ATP'
            });
            const request = yield* client['conversations.requestReply']({ sessionId: session.id });
            let waiting = false;

            for (let i = 0; i < 100; i++) {
              const rows = app.store.db.orm.all(
                sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id=w.execution_id WHERE e.workflow_tag='conversation-reply/v1'`
              );

              if (rows.length === 1) {
                waiting = true;
                break;
              }

              yield* Effect.sleep('50 millis');
            }

            assert.ok(waiting, 'reply must wait durably for account setup');
            assert.equal(app.store.db.orm.all(sql`SELECT * FROM workflow_clocks`).length, 0);
            const untitled = yield* client['conversations.createUntitledSession']({
              project: project.id
            });

            yield* client['conversations.postMessage']({
              sessionId: untitled.id,
              text: 'Study photosynthesis'
            });
            yield* client['conversations.requestTitle']({ sessionId: untitled.id });
            let titleWaiting = false;

            for (let i = 0; i < 100; i++) {
              if (
                app.store.db.orm.all(
                  sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id=w.execution_id WHERE e.workflow_tag='conversation-title/v1'`
                ).length === 1
              ) {
                titleWaiting = true;
                break;
              }

              yield* Effect.sleep('50 millis');
            }

            assert.ok(titleWaiting, 'title request must enter durable configuration wait');

            const message = yield* client['conversations.message']({ id: request.messageId });

            assert.equal(
              message.versions.find((version) => version.id === request.versionId)?.status,
              'pending'
            );
            assert.equal(
              (yield* client['conversations.thread']({ sessionId: session.id, limit: 10 })).items
                .length,
              2
            );
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);
