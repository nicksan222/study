/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Covers session and message pagination, immutable versions, attachment ownership    │
 * │ and snapshots, reply and title context limits, outbox rollback, thread isolation,        │
 * │ validation, and explicit or mention-triggered replies.                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises pagination, ownership fences, captured context, and atomic outbox behavior.  │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plainBlock } from '@study/contracts/sources/document';
import { eq } from '@study/db';
import { material_versions, materials, workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';

import { Conversations } from '#server/features/conversations/service/index';
import { Materials } from '#server/features/materials/service/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

const meta = {
  language: null,
  originalFormat: 'text',
  extractor: null,
  extractorVersion: 1,
  provider: null,
  durationMs: null,
  pageCount: null,
  refiners: [],
  waitingFor: [],
  corrected: false,
  omissions: []
};

test('sidebar summaries count distinct attached generated documents and report durable work', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Conversations.layer, Materials.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const library = yield* Materials;
        const session = yield* conversations.createSession({ title: 'Study' });

        yield* conversations.setSessionSettled({ id: session.id, settled: true });
        assert.equal((yield* conversations.sessionSummaries({})).items[0]?.settledOverride, true);
        yield* conversations.setSessionSettled({ id: session.id, settled: true });
        assert.equal((yield* conversations.sessionSummaries({})).items[0]?.settledOverride, true);
        yield* conversations.setSessionSettled({ id: session.id, settled: false });
        assert.equal((yield* conversations.sessionSummaries({})).items[0]?.settledOverride, false);
        const missing = yield* Effect.flip(
          conversations.setSessionSettled({
            id: (session.id + 1000n) as typeof session.id,
            settled: true
          })
        );

        assert.equal(missing.kind, 'not_found');
        const document = { blocks: [plainBlock('paragraph', 'Notes', { type: 'authored' })], meta };

        yield* library.createManualDocument({ title: 'Manual', document, sessionId: session.id });
        const generated = yield* library.create({
          title: 'Generated',
          content: {
            kind: 'document',
            ...document,
            blocks: [plainBlock('paragraph', 'Generated', { type: 'authored' })]
          },
          sessionId: session.id,
          publish: false
        });

        context.db.orm
          .update(material_versions)
          .set({ creator: 'agent' })
          .where(eq(material_versions.id, generated.version.id))
          .run();
        assert.equal(
          (yield* conversations.sessionSummaries({})).items[0]?.generatedDocumentCount,
          0n
        );
        yield* library.publishVersion({ id: generated.version.id });
        const summary = (yield* conversations.sessionSummaries({})).items[0];

        assert.deepEqual(summary, {
          id: session.id,
          generatedDocumentCount: 1n,
          settledOverride: false,
          running: false,
          activity: 'idle'
        });
        context.db.orm
          .update(materials)
          .set({ archived_at: generated.created_at })
          .where(eq(materials.id, generated.id))
          .run();
        assert.equal(
          (yield* conversations.sessionSummaries({})).items[0]?.generatedDocumentCount,
          0n
        );
        const note = yield* conversations.postMessage({
          sessionId: session.id,
          text: 'Question',
          requestReply: false
        });
        const request = yield* conversations.requestReply({ sessionId: session.id });

        context.db.orm
          .insert(workflow_executions)
          .values({
            execution_id: 'sidebar-test',
            workflow_tag: 'test',
            version: 1,
            payload: JSON.stringify({ event: { correlationId: request.requestId } }),
            status: 'running',
            created_at: note.createdAt,
            updated_at: note.createdAt
          })
          .run();
        assert.equal((yield* conversations.sessionSummaries({})).items[0]?.activity, 'answering');
        context.db.orm
          .update(workflow_executions)
          .set({ status: 'completed' })
          .where(eq(workflow_executions.execution_id, 'sidebar-test'))
          .run();
        assert.equal((yield* conversations.sessionSummaries({})).items[0]?.running, false);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
