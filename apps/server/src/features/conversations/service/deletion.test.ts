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
import { test } from 'node:test';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect, Exit, Layer, Option, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import {
  sessionDeletionHandler,
  sessionDeletionWorkflow
} from '#server/features/conversations/workflows/deletion';
import { Materials } from '#server/features/materials/index';
import { materialGenerationWorkflow } from '#server/features/materials/workflows/generation';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowStore } from '#server/platform/workflows/store';
import { dispatchPending } from '#server/platform/workflows/triggers';
import { documentTransformFixture } from '#testing/document-transform';
import {
  setup,
  deletionEvent,
  cleanup,
  assertScrubbed,
  annotateLibrary,
  libraryState
} from '#testing/session-deletion';

test('native deletion RPC commits an idempotent unavailable barrier and scrubs queued captures after reopen', async () => {
  const fixture = await documentTransformFixture();
  const marker = 'SESSION_ONLY_DELETE_RPC_8';

  try {
    const saved = await setup(fixture, marker);
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
              targets: [{ versionId: saved.library.version.id, scope: { kind: 'document' } }]
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
            event: 'MaterialGenerationRequested',
            workflowVersion: 1,
            workflow: materialGenerationWorkflow,
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
          (yield* (yield* Materials).materialVersion({ id: saved.library.version.id })).status,
          'published'
        );
        assert.equal(
          (yield* chats.thread({ sessionId: saved.other.id, limit: 10 })).items[0]?.text,
          'Other conversation'
        );

        return status;
      }).pipe(Effect.provide(fixture.domain()))
    );

    assertScrubbed(fixture, marker);
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
            event: 'MaterialGenerationRequested',
            workflowVersion: 1,
            workflow: materialGenerationWorkflow,
            enabled: () => true,
            emits: []
          }
        ],
        Date.now()
      ),
      0
    );
    assertScrubbed(fixture, marker);
  } finally {
    await fixture.close();
  }
});

test('deletion intent/outbox failure rolls back the barrier and conversation removal', async () => {
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
      fixture.context.db.orm.select().from(s.session_generation_retirements).all().length,
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
});

test('failed cleanup remains inspectable and retries the same logical deletion after restart', async () => {
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
      sql.raw(`CREATE TRIGGER reject_retirement BEFORE UPDATE ON material_generation_requests
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
    assertScrubbed(fixture, marker);
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
});

test('pending deletion can retry its terminal attempt after cleanup and failure settlement both fail', async () => {
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
        `CREATE TRIGGER reject_private_retirement BEFORE UPDATE ON material_generation_requests WHEN NEW.payload='{}' BEGIN SELECT RAISE(ABORT, 'injected cleanup failure'); END`
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
    assertScrubbed(fixture, marker);
    assert.equal(
      fixture.context.db.orm.select().from(s.session_deletions).get()?.status,
      'completed'
    );
  } finally {
    await fixture.close();
  }
});

test('completed library publication wins deletion while native payload copies are fenced and scrubbed', async () => {
  const fixture = await documentTransformFixture();
  const marker = 'COMPLETED_SESSION_ONLY_8';

  try {
    const saved = await setup(fixture, marker);

    fixture.replies.push(
      { kind: 'sources', query: 'independent' },
      {
        kind: 'output',
        output: {
          blocks: [
            {
              type: 'paragraph',
              inlines: [{ type: 'text', text: 'INTENTIONAL_PUBLISHED_COPY_8 [1]', marks: [] }]
            }
          ],
          notes: []
        }
      }
    );
    await fixture.execute(fixture.event(saved.request.id), 'completed-before-delete');
    const receipt = fixture.context.db.orm
      .select()
      .from(s.material_generation_requests)
      .where(eq(s.material_generation_requests.id, saved.request.id))
      .get()!;

    assert.ok(receipt.result_version_id);
    assert.equal(
      fixture.context.db.orm
        .select()
        .from(s.material_versions)
        .where(eq(s.material_versions.id, receipt.result_version_id))
        .get()?.instruction,
      null
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
    assertScrubbed(fixture, marker);
    assert.equal(
      fixture.context.db.orm
        .select()
        .from(s.material_generation_requests)
        .where(eq(s.material_generation_requests.id, saved.request.id))
        .get()?.result_version_id,
      receipt.result_version_id
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* (yield* Materials).materialVersion({
          id: receipt.result_version_id!
        });

        assert.equal(result.status, 'published');
        assert.equal(result.content.kind, 'document');
        assert.ok(
          JSON.stringify(result.content, (_, value) =>
            typeof value === 'bigint' ? String(value) : value
          ).includes('INTENTIONAL_PUBLISHED_COPY_8')
        );
      }).pipe(Effect.provide(fixture.domain()))
    );
    const libraryEvent = fixture.context.db.orm
      .select()
      .from(s.workflowEvents)
      .where(eq(s.workflowEvents.type, 'MaterialPublished'))
      .all()
      .find((row) => row.correlationId === saved.request.id);

    assert.ok(libraryEvent);
    assert.notEqual(libraryEvent.payload, '{}');

    assert.deepEqual(await libraryState(fixture, retainedIds), beforeDeletion);

    fixture.reopen();

    assert.deepEqual(await libraryState(fixture, retainedIds), beforeDeletion);

    const native = workflowStore(fixture.context);

    native.start(
      'independent-library-consumer',
      'library-consumer-test',
      JSON.stringify({ event: decodeEvent(libraryEvent.payload) }, (_, value) =>
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
        materialGenerationWorkflow._tag,
        JSON.stringify({
          event: { type: 'MaterialGenerationRequested', correlationId: saved.request.id, marker }
        }),
        undefined
      )
    );
    assertScrubbed(fixture, marker);
  } finally {
    await fixture.close();
  }
});

test('late provider response after acceptance cannot publish or repopulate native checkpoints', async () => {
  const fixture = await documentTransformFixture();
  const marker = 'LATE_PROVIDER_SESSION_8';

  try {
    const saved = await setup(fixture, marker);
    const event = fixture.event(saved.request.id);

    fixture.replies.push(
      { kind: 'sources', query: 'independent' },
      {
        kind: 'output',
        output: {
          blocks: [
            {
              type: 'paragraph',
              inlines: [{ type: 'text', text: 'Late unpublished response [1]', marks: [] }]
            }
          ],
          notes: []
        }
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
    await fixture.execute(event, 'late-provider-delete').catch(() => undefined);
    await cleanup(fixture, saved.session.id);
    const request = fixture.context.db.orm
      .select()
      .from(s.material_generation_requests)
      .where(eq(s.material_generation_requests.id, saved.request.id))
      .get();

    assert.equal(request?.result_version_id, null);
    assert.equal(fixture.context.db.orm.select().from(s.materials).all().length, 1);
    assertScrubbed(fixture, marker);

    assertScrubbed(fixture, 'Late unpublished response');

    assert.ok(
      !JSON.stringify(
        fixture.context.db.orm.select().from(s.workflow_activities).all(),
        (_, value) => (typeof value === 'bigint' ? String(value) : value)
      ).includes('Late unpublished response')
    );
    fixture.reopen();
    assertScrubbed(fixture, marker);
  } finally {
    await fixture.close();
  }
});

test('native suspended Activity state is retired without cancelling an independent library execution', async () => {
  const fixture = await documentTransformFixture();
  const marker = 'SUSPENDED_PRIVATE_PARTIAL_8';

  try {
    const saved = await setup(fixture, marker);
    const event = fixture.event(saved.request.id);
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

          yield* engine.register(materialGenerationWorkflow, () =>
            Effect.gen(function* () {
              yield* Activity.make({
                name: 'session-partial',
                success: Schema.String,
                execute: Effect.succeed(marker)
              });
              yield* DurableDeferred.await(gate);

              return saved.library.version.id;
            })
          );
          yield* engine.register(independent, () =>
            DurableDeferred.await(independentGate).pipe(Effect.as('independent survived'))
          );
          yield* engine.register(sessionDeletionWorkflow, sessionDeletionHandler);
          yield* engine.execute(materialGenerationWorkflow, {
            executionId: 'suspended-session-run',
            payload: { event },
            discard: true
          });
          yield* engine.execute(independent, {
            executionId: 'independent-run',
            payload: { id: 'independent' },
            discard: true
          });

          for (let attempt = 0; attempt < 100; attempt++) {
            if (
              workflowStore(fixture.context).execution('suspended-session-run')?.status ===
                'suspended' &&
              workflowStore(fixture.context).execution('independent-run')?.status === 'suspended'
            )
              break;

            yield* Effect.sleep('5 millis');
          }

          assert.equal(
            workflowStore(fixture.context).execution('suspended-session-run')?.status,
            'suspended'
          );
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
            workflowName: materialGenerationWorkflow._tag,
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

          for (let attempt = 0; attempt < 100; attempt++) {
            if (workflowStore(fixture.context).execution('independent-run')?.status === 'completed')
              break;

            yield* Effect.sleep('5 millis');
          }

          assert.equal(
            workflowStore(fixture.context).execution('independent-run')?.status,
            'completed'
          );
          assertScrubbed(fixture, marker);
        }).pipe(Effect.provide(fixture.services()))
      )
    );
    fixture.reopen();
    assertScrubbed(fixture, marker);
  } finally {
    await fixture.close();
  }
});

test('kept and applied library results survive removal of their proposal draft and prompt receipts', async () => {
  const fixture = await documentTransformFixture();
  const marker = 'PROPOSAL_ONLY_SESSION_8';

  try {
    const saved = await setup(fixture, marker, true);

    fixture.replies.push(
      { kind: 'sources', query: 'independent' },
      {
        kind: 'output',
        output: {
          blocks: [
            {
              type: 'paragraph',
              inlines: [{ type: 'text', text: 'Retained edited result [1]', marks: [] }]
            }
          ],
          notes: []
        }
      }
    );
    await fixture.execute(fixture.event(saved.request.id), 'proposal-before-delete');
    const retained = await Effect.runPromise(
      Effect.gen(function* () {
        const chats = yield* Conversations;
        const keep = yield* chats.keepDocumentProposal({
          requestId: saved.request.id,
          key: 'keep-before-delete'
        });
        const applyValue = {
          requestId: saved.request.id,
          key: 'apply-before-delete',
          baseVersionId: saved.library.version.id,
          expectedVersionId: saved.library.version.id
        };
        const apply = yield* chats.applyDocumentProposal(applyValue);

        assert.equal(apply.outcome, 'applied');
        yield* chats.deleteSession(saved.session.id);

        return { keep, apply, applyValue };
      }).pipe(Effect.provide(fixture.domain()))
    );

    assert.throws(() =>
      fixture.context.db.orm.run(sql`
      INSERT INTO retired_document_proposal_receipts
      (key,intent,current_version_id,proposed_version_id,request_id,operation,outcome,base_version_id,result_version_id)
      SELECT r.key,json_set(r.intent,'$.projectId','999'),r.current_version_id,p.proposed_version_id,r.request_id,r.operation,r.outcome,p.base_version_id,r.result_version_id
      FROM document_proposal_receipts r JOIN document_proposals p ON p.request_id=r.request_id
      WHERE r.key='keep-before-delete'
    `)
    );
    assert.equal(
      fixture.context.db.orm.select().from(s.retired_document_proposal_receipts).all().length,
      0
    );
    await cleanup(fixture, saved.session.id);
    assert.equal(fixture.context.db.orm.select().from(s.document_proposals).all().length, 0);
    assert.equal(
      fixture.context.db.orm.select().from(s.document_proposal_receipts).all().length,
      0
    );
    assert.equal(
      fixture.context.db.orm
        .select()
        .from(s.material_versions)
        .where(eq(s.material_versions.id, retained.apply.proposedVersionId))
        .get(),
      undefined
    );
    assertScrubbed(fixture, marker);
    fixture.reopen();
    await Effect.runPromise(
      Effect.gen(function* () {
        const chats = yield* Conversations;
        const materials = yield* Materials;

        for (const id of [
          retained.keep.resultVersionId!,
          retained.apply.resultVersionId!,
          saved.library.version.id
        ])
          assert.equal((yield* materials.materialVersion({ id })).status, 'published');

        const kept = yield* chats.keepDocumentProposal({
          requestId: saved.request.id,
          key: 'keep-before-delete'
        });
        const applied = yield* chats.applyDocumentProposal(retained.applyValue);

        assert.deepEqual(kept, { ...retained.keep, replayed: true });
        assert.deepEqual(applied, { ...retained.apply, replayed: true });
        assert.equal(
          (yield* Effect.flip(
            chats.keepDocumentProposal({ requestId: saved.request.id, key: 'new-after-delete' })
          )).kind,
          'not_found'
        );
        assert.equal(
          (yield* materials.citations({ id: applied.resultVersionId!, limit: 10 })).items.length,
          1
        );
      }).pipe(Effect.provide(fixture.domain()))
    );
  } finally {
    await fixture.close();
  }
});
