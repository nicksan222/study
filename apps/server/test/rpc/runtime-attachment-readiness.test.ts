import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { Conversations } from '#server/features/conversations/index';
import { serve } from '#server/runtime/index';
import { createStudyTest } from '#testing/server-test';

test(
  'HTTP attachment replies wake through registered source subscriptions before waiting for authentication',
  { timeout: 15000 },
  async (t) => {
    const fixture = await createStudyTest(t);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const peer = createServer(async (_request, response) => {
      await gate;
      response.writeHead(200, { 'content-type': 'text/plain' }).end('Captured alpha evidence');
    });

    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
    fixture.dispose(async () => {
      release();
      peer.closeAllConnections();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
    });
    const address = peer.address();

    if (!address || typeof address === 'string') throw new Error('missing source peer address');

    const evidenceUrl = `http://127.0.0.1:${address.port}/evidence.txt`;
    const server = fixture.manage(await serve(fixture.app));

    function* verifyAttachmentReadinessWake() {
      const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
      const project = yield* client['projects.createProject']({ name: 'Readiness' });
      const source = yield* client['sources.addLink']({
        projectId: project.id,
        url: evidenceUrl
      });
      const session = yield* client['conversations.createSession']({
        project: project.id,
        title: 'Chat'
      });

      yield* client['conversations.postMessage']({
        sessionId: session.id,
        text: 'Explain the evidence',
        sourceIds: [source.id]
      });
      const request = yield* client['conversations.requestReply']({ sessionId: session.id });

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

      assert.equal(waiting, true);
      assert.equal(
        fixture.store.db.orm.all(sql`SELECT * FROM workflow_configuration_waits`).length,
        0
      );
      const before = yield* Effect.promise(() =>
        fixture.run(
          Effect.flatMap(Conversations, (conversations) =>
            conversations.replySnapshot({ requestId: request.requestId })
          )
        )
      );

      assert.equal(before.pendingAttachments?.length, 1);
      release();
      let authentication = false;

      for (let i = 0; i < 150; i++) {
        if (fixture.store.db.orm.all(sql`SELECT * FROM workflow_configuration_waits`).length > 0) {
          authentication = true;
          break;
        }

        yield* Effect.sleep('25 millis');
      }

      assert.equal(
        authentication,
        true,
        'the registered wake subscription must resume the actual dispatched reply'
      );
      const after = yield* Effect.promise(() =>
        fixture.run(
          Effect.flatMap(Conversations, (conversations) =>
            conversations.replySnapshot({ requestId: request.requestId })
          )
        )
      );

      assert.equal(after.pendingAttachments, undefined);
      assert.equal(after.messages[0]?.attachments[0]?.sourceId, source.id);
      assert.equal(
        after.messages[0]?.attachments[0]?.documentId,
        (yield* client['sources.sourceProcessing']({ id: source.id })).documentId
      );
    }

    await Effect.runPromise(Effect.scoped(Effect.gen(verifyAttachmentReadinessWake)));
  }
);
