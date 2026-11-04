/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Covers durable deletion with migrated SQLite, native RPC and Workflow cleanup.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retains durable ownership and content-free retirement state.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy uses public participants; native Workflow owns execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect, Exit, Layer, Option, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import {
  sessionDeletionHandler,
  sessionDeletionWorkflow
} from '#server/features/conversations/workflows/deletion';
import { Documents } from '#server/features/documents/index';
import { documentTransformWorkflow } from '#server/features/documents/workflows/transform';
import { workflowStore } from '#server/platform/workflows/store';
import { dispatchPending } from '#server/platform/workflows/triggers';
import { documentTransformFixture } from '#testing/document-transform';
import {
  setup,
  deletionEvent,
  cleanup,
  assertScrubbed,
  annotateLibrary,
  libraryState,
  awaitNativeStatus,
  validDocumentTransformOutput
} from '#testing/session-deletion';

testStable(
  'native deletion RPC commits an idempotent unavailable barrier and scrubs queued captures after reopen',
  async () => {
    const fixture = await documentTransformFixture();
    const marker = 'SESSION_ONLY_DELETE_RPC_8';

    try {
      const saved = await setup(fixture, marker);
      const otherThread = await Effect.runPromise(
        Effect.flatMap(Conversations, (chats) =>
          chats.thread({ sessionId: saved.other.id, limit: 10 })
        ).pipe(Effect.provide(fixture.domain()))
      );
      const handlers = ConversationsRpcLive.pipe(Layer.provideMerge(fixture.domain()));
      const accepted = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const status = yield* client('conversations.deleteSession', { id: saved.session.id });

            assert.equal(status.status, 'pending');

            assert.deepEqual(
              yield* client('conversations.sessionDeletion', { id: saved.session.id }),
              status
            );
            assert.deepEqual(
              yield* client('conversations.retrySessionDeletion', { id: saved.session.id }),
              status
            );
            const rejected = [
              client('conversations.renameSession', {
                id: saved.session.id,
                title: 'Late rename'
              }).pipe(Effect.asVoid),
              client('conversations.requestTitle', { sessionId: saved.session.id }).pipe(
                Effect.asVoid
              ),
              client('conversations.updateSessionSelection', {
                sessionId: saved.session.id,
                expectedRevision: 1n,
                targets: [
                  {
                    input: { kind: 'document', versionId: saved.library.version.id },
                    scope: { kind: 'document' }
                  }
                ]
              }).pipe(Effect.asVoid)
            ];

            for (const action of rejected)
              assert.equal((yield* Effect.flip(action)).kind, 'not_found');

            assert.deepEqual(
              yield* client('conversations.deleteSession', { id: saved.session.id }),
              status
            );
            assert.ok(
              Option.isNone(yield* client('conversations.findSession', { id: saved.session.id }))
            );
            assert.equal((yield* client('conversations.sessions', { limit: 10 })).items.length, 1);
            assert.equal(
              (yield* Effect.flip(
                client('conversations.postMessage', {
                  sessionId: saved.session.id,
                  text: 'late message',
                  requestReply: false
                })
              )).kind,
              'not_found'
            );
            assert.equal(
              (yield* Effect.flip(
                client('conversations.captureSessionContext', {
                  sessionId: saved.session.id,
                  intentKey: 'late',
                  instruction: '',
                  preferences: {}
                })
              )).kind,
              'not_found'
            );

            return status;
          }).pipe(Effect.provide(handlers))
        )
      );
      // The original generation event is still queued, but may never start after acceptance.

      assert.equal(
        dispatchPending(
          fixture.context,
          [
            {
              subscription: 'delete-test-generation',
              event: 'DocumentGenerationRequested',
              workflowVersion: 1,
              workflow: documentTransformWorkflow,
              enabled: () => true,
              emits: []
            }
          ],
          Date.now()
        ),
        0
      );
      fixture.reopen();
      await cleanup(fixture, saved.session.id);
      const done = await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          const status = yield* chats.sessionDeletion(saved.session.id);

          assert.equal(status.status, 'completed');
          assert.equal(status.operationId, accepted.operationId);
          assert.ok(status.completedAt !== null);
          assert.deepEqual(yield* chats.deleteSession(saved.session.id), status);
          assert.equal(
            (yield* (yield* Documents).version({ id: saved.library.version.id })).status,
            'published'
          );
          const retainedThread = yield* chats.thread({ sessionId: saved.other.id, limit: 10 });
          const otherMessage = retainedThread.items[0];

          assert.deepEqual(retainedThread, otherThread);

          assert.ok(otherMessage);
          assert.equal(otherMessage.sessionId, saved.other.id);
          assert.equal(
            otherMessage.versions.find((version) => version.id === otherMessage.activeVersionId)
              ?.text,
            'Other conversation'
          );

          return status;
        }).pipe(Effect.provide(fixture.domain()))
      );

      assertScrubbed(fixture, marker, true);
      fixture.reopen();
      assert.deepEqual(
        await Effect.runPromise(
          Effect.flatMap(Conversations, (chats) => chats.sessionDeletion(saved.session.id)).pipe(
            Effect.provide(fixture.domain())
          )
        ),
        done
      );
      assert.equal(
        dispatchPending(
          fixture.context,
          [
            {
              subscription: 'delete-test-generation',
              event: 'DocumentGenerationRequested',
              workflowVersion: 1,
              workflow: documentTransformWorkflow,
              enabled: () => true,
              emits: []
            }
          ],
          Date.now()
        ),
        0
      );
      assertScrubbed(fixture, marker, true);
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'deletion intent/outbox failure rolls back the barrier and conversation removal',
  async () => {
    const fixture = await documentTransformFixture();

    try {
      const saved = await setup(fixture, 'ROLLBACK_DELETE_8');

      fixture.context.db.orm.run(
        sql.raw(`CREATE TRIGGER reject_deletion_event BEFORE INSERT ON workflow_events
      WHEN NEW.type='SessionDeletionRequested' BEGIN SELECT RAISE(ABORT, 'injected'); END`)
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;

          yield* Effect.flip(chats.deleteSession(saved.session.id));
          assert.equal((yield* chats.session(saved.session.id)).id, saved.session.id);
          assert.equal(
            (yield* chats.sessionContext({ requestId: saved.capture.requestId })).instruction,
            'ROLLBACK_DELETE_8-instruction'
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      assert.equal(fixture.context.db.orm.select().from(s.session_deletions).all().length, 0);
      assert.equal(
        fixture.context.db.orm.select().from(s.workflow_retired_correlations).all().length,
        0
      );
      assert.equal(
        fixture.context.db.orm.select().from(s.workflow_retired_correlations).all().length,
        0
      );
      fixture.context.db.orm.run(sql.raw('DROP TRIGGER reject_deletion_event'));
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'failed cleanup remains inspectable and retries the same logical deletion after restart',
  async () => {
    const fixture = await documentTransformFixture();
    const marker = 'RETRY_DELETE_8';

    try {
      const saved = await setup(fixture, marker);
      const accepted = await Effect.runPromise(
        Effect.flatMap(Conversations, (chats) => chats.deleteSession(saved.session.id)).pipe(
          Effect.provide(fixture.domain())
        )
      );

      fixture.context.db.orm.run(
        sql.raw(`CREATE TRIGGER reject_retirement BEFORE UPDATE ON workflow_events
      WHEN NEW.payload='{}' BEGIN SELECT RAISE(ABORT, 'injected private content must not enter status'); END`)
      );
      await cleanup(fixture, saved.session.id).catch(() => undefined);
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          const failed = yield* chats.sessionDeletion(saved.session.id);

          assert.equal(failed.status, 'failed');
          assert.equal(failed.completedAt, null);
          assert.equal(failed.errorKind, 'internal');
          assert.ok(
            !JSON.stringify(failed, (_, value) =>
              typeof value === 'bigint' ? String(value) : value
            ).includes('private content')
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      fixture.context.db.orm.run(sql.raw('DROP TRIGGER reject_retirement'));
      fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          const retry = yield* chats.retrySessionDeletion(saved.session.id);

          assert.equal(retry.operationId, accepted.operationId);
          assert.equal(retry.attempt, 2);
          assert.equal(retry.status, 'pending');
          assert.deepEqual(yield* chats.retrySessionDeletion(saved.session.id), retry);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await cleanup(fixture, saved.session.id);
      assertScrubbed(fixture, marker, true);
      assert.equal(
        await Effect.runPromise(
          Effect.flatMap(Conversations, (chats) => chats.sessionDeletion(saved.session.id)).pipe(
            Effect.map((value) => value.status),
            Effect.provide(fixture.domain())
          )
        ),
        'completed'
      );
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'pending deletion can retry its terminal attempt after cleanup and failure settlement both fail',
  async () => {
    const fixture = await documentTransformFixture();
    const marker = 'DOUBLE_FAILURE_SESSION_ONLY_8';

    try {
      const saved = await setup(fixture, marker);
      const accepted = await Effect.runPromise(
        Effect.flatMap(Conversations, (chats) => chats.deleteSession(saved.session.id)).pipe(
          Effect.provide(fixture.domain())
        )
      );

      fixture.context.db.orm.run(
        sql.raw(
          `CREATE TRIGGER reject_private_retirement BEFORE UPDATE ON workflow_events WHEN NEW.payload='{}' BEGIN SELECT RAISE(ABORT, 'injected cleanup failure'); END`
        )
      );
      fixture.context.db.orm.run(
        sql.raw(
          `CREATE TRIGGER reject_failure_settlement BEFORE UPDATE ON session_deletions WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT, 'injected settlement failure'); END`
        )
      );
      await cleanup(fixture, saved.session.id).catch(() => undefined);
      assert.equal(
        workflowStore(fixture.context).execution(`cleanup/${accepted.operationId}/1`)?.status,
        'completed'
      );
      assert.equal(
        fixture.context.db.orm.select().from(s.session_deletions).get()?.status,
        'pending'
      );
      fixture.context.db.orm.run(sql.raw('DROP TRIGGER reject_private_retirement'));
      fixture.context.db.orm.run(sql.raw('DROP TRIGGER reject_failure_settlement'));
      fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          const retry = yield* chats.retrySessionDeletion(saved.session.id);

          assert.equal(retry.operationId, accepted.operationId);
          assert.equal(retry.attempt, 2);
          assert.equal(retry.status, 'pending');
          assert.deepEqual(yield* chats.retrySessionDeletion(saved.session.id), retry);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await cleanup(fixture, saved.session.id);
      assertScrubbed(fixture, marker, true);
      assert.equal(
        fixture.context.db.orm.select().from(s.session_deletions).get()?.status,
        'completed'
      );
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'completed library publication wins deletion while native payload copies are fenced and scrubbed',
  async () => {
    const fixture = await documentTransformFixture();
    const marker = 'COMPLETED_SESSION_ONLY_8';

    try {
      const saved = await setup(fixture, marker);

      fixture.replies.push(
        { kind: 'sources', query: 'independent' },
        {
          kind: 'output',
          output: validDocumentTransformOutput('INTENTIONAL_PUBLISHED_COPY_8 [1]')
        }
      );
      await fixture.executeAuthored(
        fixture.authoredEvent(saved.request.id),
        'completed-before-delete'
      );
      const receipt = fixture.context.db.orm
        .select()
        .from(s.study_document_transform_requests)
        .where(eq(s.study_document_transform_requests.id, saved.request.id))
        .get()!;

      assert.ok(receipt.result_version_id);
      assert.equal(
        fixture.context.db.orm
          .select()
          .from(s.study_document_versions)
          .where(eq(s.study_document_versions.id, receipt.result_version_id))
          .get()?.instruction,
        marker + '-instruction'
      );

      const retainedIds = [saved.library.version.id, receipt.result_version_id];

      await annotateLibrary(fixture, retainedIds);

      const beforeDeletion = await libraryState(fixture, retainedIds);

      await Effect.runPromise(
        Effect.flatMap(Conversations, (chats) => chats.deleteSession(saved.session.id)).pipe(
          Effect.provide(fixture.domain())
        )
      );
      await cleanup(fixture, saved.session.id);
      assertScrubbed(fixture, marker, true);
      assert.equal(
        fixture.context.db.orm
          .select()
          .from(s.study_document_transform_requests)
          .where(eq(s.study_document_transform_requests.id, saved.request.id))
          .get()?.result_version_id,
        receipt.result_version_id
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* (yield* Documents).version({
            id: receipt.result_version_id!
          });

          assert.equal(result.status, 'published');
          assert.ok(
            JSON.stringify(result.document, (_, value) =>
              typeof value === 'bigint' ? String(value) : value
            ).includes('INTENTIONAL_PUBLISHED_COPY_8')
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      const libraryEvent = fixture.context.db.orm
        .select()
        .from(s.workflowEvents)
        .where(eq(s.workflowEvents.type, 'DocumentPublished'))
        .all()
        .find((row) => row.correlationId === saved.request.id);

      assert.ok(libraryEvent);
      assert.equal(libraryEvent.payload, '{}');

      assert.deepEqual(await libraryState(fixture, retainedIds), beforeDeletion);

      fixture.reopen();

      assert.deepEqual(await libraryState(fixture, retainedIds), beforeDeletion);

      const native = workflowStore(fixture.context);

      native.start(
        'independent-library-consumer',
        'library-consumer-test',
        JSON.stringify({ documentVersionId: receipt.result_version_id }, (_, value) =>
          typeof value === 'bigint' ? String(value) : value
        ),
        undefined
      );
      assert.equal(native.execution('independent-library-consumer')?.status, 'running');

      assert.equal(native.claim('completed-before-delete', 'stale-owner'), false);
      native.checkpoint(
        'completed-before-delete',
        'stale-owner',
        JSON.stringify({ marker }),
        'completed'
      );
      assert.throws(() =>
        native.saveActivity(
          'completed-before-delete',
          'stale-owner',
          'late',
          1,
          JSON.stringify({ marker })
        )
      );
      assert.equal(
        native.saveDeferred('completed-before-delete', 'late', JSON.stringify({ marker })),
        false
      );
      assert.throws(() =>
        native.start(
          'late-new-id',
          documentTransformWorkflow._tag,
          JSON.stringify({
            event: { type: 'DocumentGenerationRequested', correlationId: saved.request.id, marker }
          }),
          undefined
        )
      );
      assertScrubbed(fixture, marker, true);
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'late provider response after acceptance cannot publish or repopulate native checkpoints',
  async () => {
    const fixture = await documentTransformFixture();
    const marker = 'LATE_PROVIDER_SESSION_8';

    try {
      const saved = await setup(fixture, marker);
      const event = fixture.authoredEvent(saved.request.id);

      fixture.replies.push(
        { kind: 'sources', query: 'independent' },
        {
          kind: 'output',
          output: validDocumentTransformOutput('Late unpublished response [1]')
        }
      );
      fixture.beforeOutput(() =>
        Effect.runPromise(
          Effect.flatMap(Conversations, (chats) => chats.deleteSession(saved.session.id)).pipe(
            Effect.asVoid,
            Effect.provide(fixture.domain())
          )
        )
      );
      await assert.rejects(fixture.executeAuthored(event, 'late-provider-delete'));
      assert.equal(fixture.bodies.length, 2);
      await cleanup(fixture, saved.session.id);
      const request = fixture.context.db.orm
        .select()
        .from(s.study_document_transform_requests)
        .where(eq(s.study_document_transform_requests.id, saved.request.id))
        .get();

      assert.equal(request?.result_version_id, null);
      assert.equal(fixture.context.db.orm.select().from(s.study_documents).all().length, 1);
      assertScrubbed(fixture, marker, true);

      assertScrubbed(fixture, 'Late unpublished response');

      assert.ok(
        !JSON.stringify(
          fixture.context.db.orm.select().from(s.workflow_activities).all(),
          (_, value) => (typeof value === 'bigint' ? String(value) : value)
        ).includes('Late unpublished response')
      );
      fixture.reopen();
      assertScrubbed(fixture, marker, true);
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'native suspended Activity state is retired without cancelling an independent library execution',
  async () => {
    const fixture = await documentTransformFixture();
    const marker = 'SUSPENDED_PRIVATE_PARTIAL_8';

    try {
      const saved = await setup(fixture, marker);
      const event = fixture.authoredEvent(saved.request.id);
      const gate = DurableDeferred.make('suspended-session');
      const independentGate = DurableDeferred.make('independent-library');
      const independent = Workflow.make('independent-library-test', {
        payload: { id: Schema.String },
        idempotencyKey: ({ id }) => id,
        success: Schema.String
      });

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;
            const chats = yield* Conversations;

            const suspendedGeneration = Effect.gen(function* () {
              yield* Activity.make({
                name: 'session-partial',
                success: Schema.String,
                execute: Effect.succeed(marker)
              });
              yield* DurableDeferred.await(gate);

              return saved.library.version.id;
            });

            yield* engine.register(documentTransformWorkflow, () => suspendedGeneration);
            yield* engine.register(independent, () =>
              DurableDeferred.await(independentGate).pipe(Effect.as('independent survived'))
            );
            yield* engine.register(sessionDeletionWorkflow, sessionDeletionHandler);
            yield* engine.execute(documentTransformWorkflow, {
              executionId: 'suspended-session-run',
              payload: { event },
              discard: true
            });
            yield* engine.execute(independent, {
              executionId: 'independent-run',
              payload: { id: 'independent' },
              discard: true
            });

            yield* awaitNativeStatus(fixture, 'suspended-session-run', 'suspended');
            yield* awaitNativeStatus(fixture, 'independent-run', 'suspended');

            yield* chats.deleteSession(saved.session.id);
            const deletion = deletionEvent(fixture, saved.session.id);

            yield* engine.execute(sessionDeletionWorkflow, {
              executionId: 'suspended-cleanup',
              payload: { event: deletion }
            });
            assert.equal((yield* chats.sessionDeletion(saved.session.id)).status, 'completed');
            assert.equal(
              workflowStore(fixture.context).execution('suspended-session-run')?.status,
              'cancelled'
            );
            assert.equal(
              workflowStore(fixture.context).execution('independent-run')?.status,
              'suspended'
            );
            yield* engine.deferredDone(gate, {
              workflowName: documentTransformWorkflow._tag,
              executionId: 'suspended-session-run',
              deferredName: gate.name,
              exit: Exit.void
            });
            assert.equal(
              workflowStore(fixture.context).deferred('suspended-session-run', gate.name),
              undefined
            );
            yield* engine.deferredDone(independentGate, {
              workflowName: independent._tag,
              executionId: 'independent-run',
              deferredName: independentGate.name,
              exit: Exit.void
            });

            yield* awaitNativeStatus(fixture, 'independent-run', 'completed');

            assertScrubbed(fixture, marker, true);
          }).pipe(Effect.provide(fixture.services()))
        )
      );
      fixture.reopen();
      assertScrubbed(fixture, marker, true);
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'kept and applied authored results preserve independent proposals and receipts after raw session deletion',
  async () => {
    const fixture = await documentTransformFixture();
    const marker = 'PROPOSAL_ONLY_SESSION_8';

    try {
      const saved = await setup(fixture, marker, true);

      fixture.replies.push(
        { kind: 'sources', query: 'independent' },
        {
          kind: 'output',
          output: validDocumentTransformOutput('Retained edited result [1]')
        }
      );
      await fixture.executeAuthored(
        fixture.authoredEvent(saved.request.id),
        'proposal-before-delete'
      );
      const retained = await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          const keep = yield* chats.keepDocumentProposal({
            requestId: saved.request.id,
            key: 'keep-before-delete',
            title: 'Independent kept copy'
          });
          const applyValue = {
            requestId: saved.request.id,
            key: 'apply-before-delete',
            expectedVersionId: saved.library.version.id
          };
          const apply = yield* chats.applyDocumentProposal(applyValue);

          assert.equal(apply.outcome, 'applied');
          yield* chats.deleteSession(saved.session.id);

          return { keep, apply, applyValue };
        }).pipe(Effect.provide(fixture.domain()))
      );

      const retainedProposal = fixture.context.db.orm
        .select()
        .from(s.study_document_proposals)
        .all();
      const retainedReceipts = fixture.context.db.orm
        .select()
        .from(s.study_document_proposal_receipts)
        .all();
      await cleanup(fixture, saved.session.id);
      assert.deepEqual(
        fixture.context.db.orm.select().from(s.study_document_proposals).all(),
        retainedProposal
      );
      assert.deepEqual(
        fixture.context.db.orm.select().from(s.study_document_proposal_receipts).all(),
        retainedReceipts
      );
      assert.equal(
        fixture.context.db.orm
          .select()
          .from(s.study_document_versions)
          .where(eq(s.study_document_versions.id, retained.apply.proposedVersionId))
          .get()?.status,
        'draft'
      );
      assertScrubbed(fixture, marker, true);
      fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          const documents = yield* Documents;

          for (const id of [
            retained.keep.resultVersionId!,
            retained.apply.resultVersionId!,
            saved.library.version.id
          ])
            assert.equal((yield* documents.version({ id })).status, 'published');

          const kept = yield* chats.keepDocumentProposal({
            requestId: saved.request.id,
            key: 'keep-before-delete',
            title: 'Independent kept copy'
          });
          const applied = yield* chats.applyDocumentProposal(retained.applyValue);

          assert.deepEqual(kept, { ...retained.keep, replayed: true });
          assert.deepEqual(applied, { ...retained.apply, replayed: true });
          assert.equal(
            (yield* Effect.flip(
              chats.keepDocumentProposal({
                requestId: saved.request.id,
                key: 'new-after-delete',
                title: 'Late copy'
              })
            )).kind,
            'not_found'
          );
          assert.equal(
            (yield* documents.version({ id: applied.resultVersionId! })).citations.length,
            1
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
    } finally {
      await fixture.close();
    }
  }
);
