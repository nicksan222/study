import { NotesRpc } from '@study/contracts';
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
import { eq, sql } from '@study/db';
import * as s from '@study/db';
import { test } from '@study/testing';
import { Effect, Exit, Layer, Option, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import { Notes } from '#server/features/notes/index';
import { NotesRpcLive } from '#server/features/notes/rpc/index';
import {
  noteDeletionHandler,
  noteDeletionWorkflow
} from '#server/features/notes/workflows/deletion';
import { Pages } from '#server/features/pages/index';
import { pageTransformWorkflow } from '#server/features/pages/workflows/transform';
import { workflowStore } from '#server/platform/workflows/store';
import { admitPending } from '#server/platform/workflows/triggers';
import { testLiveQueries } from '#testing/live-queries';
import {
  setup,
  deletionEvent,
  cleanup,
  assertScrubbed,
  annotateLibrary,
  libraryState,
  awaitNativeStatus,
  validPageTransformOutput
} from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';
import { withTestAdmission } from '#testing/workflow-admission';

test.stable(
  'native deletion RPC commits an idempotent unavailable barrier and scrubs queued captures after reopen',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);
    const marker = 'SESSION_ONLY_DELETE_RPC_8';

    try {
      const saved = await setup(fixture, marker);
      const otherThread = await Effect.runPromise(
        Effect.flatMap(Notes, (chats) => chats.thread({ noteId: saved.other.id, limit: 10 })).pipe(
          Effect.provide(fixture.domain())
        )
      );
      const handlers = NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
        Layer.provideMerge(fixture.domain())
      );
      const accepted = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const status = yield* client('notes.deleteNote', { id: saved.note.id });

            test.assert.ok(status.status === 'pending');

            test
              .expect(yield* client('notes.noteDeletion', { id: saved.note.id }))
              .toStrictEqual(status);
            test
              .expect(yield* client('notes.retryNoteDeletion', { id: saved.note.id }))
              .toStrictEqual(status);
            const rejected = [
              client('notes.renameNote', {
                id: saved.note.id,
                title: 'Late rename'
              }).pipe(Effect.asVoid),
              client('notes.requestTitle', { noteId: saved.note.id }).pipe(Effect.asVoid),
              client('notes.updateNoteSelection', {
                noteId: saved.note.id,
                expectedRevision: 1n,
                targets: [
                  {
                    input: { kind: 'page', versionId: saved.library.version.id },
                    scope: { kind: 'document' }
                  }
                ]
              }).pipe(Effect.asVoid)
            ];

            for (const action of rejected)
              test.assert.ok((yield* Effect.flip(action)).kind === 'not_found');

            test
              .expect(yield* client('notes.deleteNote', { id: saved.note.id }))
              .toStrictEqual(status);
            test.assert.ok(Option.isNone(yield* client('notes.findNote', { id: saved.note.id })));
            test.assert.strictEqual((yield* client('notes.notes', { limit: 10 })).items.length, 1);
            test.assert.ok(
              (yield* Effect.flip(
                client('notes.postMessage', {
                  noteId: saved.note.id,
                  text: 'late message',
                  requestReply: false
                })
              )).kind === 'not_found'
            );
            test.assert.ok(
              (yield* Effect.flip(
                client('notes.captureNoteContext', {
                  noteId: saved.note.id,
                  intentKey: 'late',
                  instruction: '',
                  preferences: {}
                })
              )).kind === 'not_found'
            );

            return status;
          }).pipe(Effect.provide(handlers))
        )
      );
      // The original generation event is still queued, but may never start after acceptance.

      test.assert.strictEqual(
        admitPending(
          fixture.context,
          [
            {
              subscription: 'delete-test-generation',
              event: 'PageGenerationRequested',
              workflowVersion: 1,
              workflow: pageTransformWorkflow,
              enabled: () => true,
              emits: []
            }
          ],
          Date.now()
        ),
        0
      );
      await fixture.reopen();
      await cleanup(fixture, saved.note.id);
      const done = await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;
          const status = yield* chats.noteDeletion(saved.note.id);

          test.assert.ok(status.status === 'completed');
          test.assert.strictEqual(status.operationId, accepted.operationId);
          test.assert.ok(status.completedAt !== null);
          test.expect(yield* chats.deleteNote(saved.note.id)).toStrictEqual(status);
          test.assert.ok(
            (yield* (yield* Pages).version({ id: saved.library.version.id })).status === 'published'
          );
          const retainedThread = yield* chats.thread({ noteId: saved.other.id, limit: 10 });
          const otherMessage = retainedThread.items[0];

          test.expect(retainedThread).toStrictEqual(otherThread);

          test.assert.ok(otherMessage);
          test.assert.strictEqual(otherMessage.noteId, saved.other.id);
          test.assert.ok(
            otherMessage.versions.find((version) => version.id === otherMessage.activeVersionId)
              ?.text === 'Other note'
          );

          return status;
        }).pipe(Effect.provide(fixture.domain()))
      );

      assertScrubbed(fixture, marker, true);
      await fixture.reopen();
      test
        .expect(
          await Effect.runPromise(
            Effect.flatMap(Notes, (chats) => chats.noteDeletion(saved.note.id)).pipe(
              Effect.provide(fixture.domain())
            )
          )
        )
        .toStrictEqual(done);
      test.assert.strictEqual(
        admitPending(
          fixture.context,
          [
            {
              subscription: 'delete-test-generation',
              event: 'PageGenerationRequested',
              workflowVersion: 1,
              workflow: pageTransformWorkflow,
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

test.stable(
  'deletion intent/outbox failure rolls back the barrier and note removal',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);

    try {
      const saved = await setup(fixture, 'ROLLBACK_DELETE_8');

      fixture.context.db.orm.run(
        sql.raw(`CREATE TRIGGER reject_deletion_event BEFORE INSERT ON workflow_events
      WHEN NEW.type='NoteDeletionRequested' BEGIN SELECT RAISE(ABORT, 'injected'); END`)
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;

          yield* Effect.flip(chats.deleteNote(saved.note.id));
          test.assert.strictEqual((yield* chats.note(saved.note.id)).id, saved.note.id);
          test.assert.ok(
            (yield* chats.noteContext({ requestId: saved.capture.requestId })).instruction ===
              'ROLLBACK_DELETE_8-instruction'
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      test.assert.strictEqual(
        fixture.context.db.orm.select().from(s.note_deletions).all().length,
        0
      );
      test.assert.strictEqual(
        fixture.context.db.orm.select().from(s.workflow_retired_correlations).all().length,
        0
      );
      test.assert.strictEqual(
        fixture.context.db.orm.select().from(s.workflow_retired_correlations).all().length,
        0
      );
      fixture.context.db.orm.run(sql.raw('DROP TRIGGER reject_deletion_event'));
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'failed cleanup remains inspectable and retries the same logical deletion after restart',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);
    const marker = 'RETRY_DELETE_8';

    try {
      const saved = await setup(fixture, marker);
      const accepted = await Effect.runPromise(
        Effect.flatMap(Notes, (chats) => chats.deleteNote(saved.note.id)).pipe(
          Effect.provide(fixture.domain())
        )
      );

      fixture.context.db.orm.run(
        sql.raw(`CREATE TRIGGER reject_retirement BEFORE UPDATE ON workflow_events
      WHEN NEW.payload='{}' BEGIN SELECT RAISE(ABORT, 'injected private content must not enter status'); END`)
      );
      await cleanup(fixture, saved.note.id).catch(() => undefined);
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;
          const failed = yield* chats.noteDeletion(saved.note.id);

          test.assert.ok(failed.status === 'failed');
          test.assert.ok(failed.completedAt === null);
          test.assert.ok(failed.errorKind === 'internal');
          test.assert.ok(
            !JSON.stringify(failed, (_, value) =>
              typeof value === 'bigint' ? String(value) : value
            ).includes('private content')
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      fixture.context.db.orm.run(sql.raw('DROP TRIGGER reject_retirement'));
      await fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;
          const retry = yield* chats.retryNoteDeletion(saved.note.id);

          test.assert.strictEqual(retry.operationId, accepted.operationId);
          test.assert.strictEqual(retry.attempt, 2);
          test.assert.ok(retry.status === 'pending');
          test.expect(yield* chats.retryNoteDeletion(saved.note.id)).toStrictEqual(retry);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await cleanup(fixture, saved.note.id);
      assertScrubbed(fixture, marker, true);
      test.assert.ok(
        (await Effect.runPromise(
          Effect.flatMap(Notes, (chats) => chats.noteDeletion(saved.note.id)).pipe(
            Effect.map((value) => value.status),
            Effect.provide(fixture.domain())
          )
        )) === 'completed'
      );
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'pending deletion can retry its terminal attempt after cleanup and failure settlement both fail',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);
    const marker = 'DOUBLE_FAILURE_SESSION_ONLY_8';

    try {
      const saved = await setup(fixture, marker);
      const accepted = await Effect.runPromise(
        Effect.flatMap(Notes, (chats) => chats.deleteNote(saved.note.id)).pipe(
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
          `CREATE TRIGGER reject_failure_settlement BEFORE UPDATE ON note_deletions WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT, 'injected settlement failure'); END`
        )
      );
      await cleanup(fixture, saved.note.id).catch(() => undefined);
      test.assert.ok(
        workflowStore(fixture.context).execution(`cleanup/${accepted.operationId}/1`)?.status ===
          'completed'
      );
      test.assert.ok(
        fixture.context.db.orm.select().from(s.note_deletions).get()?.status === 'pending'
      );
      fixture.context.db.orm.run(sql.raw('DROP TRIGGER reject_private_retirement'));
      fixture.context.db.orm.run(sql.raw('DROP TRIGGER reject_failure_settlement'));
      await fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;
          const retry = yield* chats.retryNoteDeletion(saved.note.id);

          test.assert.strictEqual(retry.operationId, accepted.operationId);
          test.assert.strictEqual(retry.attempt, 2);
          test.assert.ok(retry.status === 'pending');
          test.expect(yield* chats.retryNoteDeletion(saved.note.id)).toStrictEqual(retry);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await cleanup(fixture, saved.note.id);
      assertScrubbed(fixture, marker, true);
      test.assert.ok(
        fixture.context.db.orm.select().from(s.note_deletions).get()?.status === 'completed'
      );
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'completed library publication wins deletion while native payload copies are fenced and scrubbed',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);
    const marker = 'COMPLETED_SESSION_ONLY_8';

    try {
      const saved = await setup(fixture, marker);

      fixture.replies.push(
        { kind: 'sources', query: 'independent' },
        {
          kind: 'output',
          output: validPageTransformOutput('INTENTIONAL_PUBLISHED_COPY_8 [1]')
        }
      );
      await fixture.executeAuthored(
        fixture.authoredEvent(saved.request.id),
        'completed-before-delete'
      );
      const receipt = fixture.context.db.orm
        .select()
        .from(s.page_transform_requests)
        .where(eq(s.page_transform_requests.id, saved.request.id))
        .get()!;

      test.assert.ok(receipt.result_version_id);
      test.assert.strictEqual(
        fixture.context.db.orm
          .select()
          .from(s.page_versions)
          .where(eq(s.page_versions.id, receipt.result_version_id))
          .get()?.instruction,
        marker + '-instruction'
      );

      const retainedIds = [saved.library.version.id, receipt.result_version_id];

      await annotateLibrary(fixture, retainedIds);

      const beforeDeletion = await libraryState(fixture, retainedIds);
      const afterDeletion = beforeDeletion.map((state) => ({
        ...state,
        version: {
          ...state.version,
          unavailableInputs: state.version.inputs.filter((input) => input.kind === 'message')
        }
      }));

      await Effect.runPromise(
        Effect.flatMap(Notes, (chats) => chats.deleteNote(saved.note.id)).pipe(
          Effect.provide(fixture.domain())
        )
      );
      await cleanup(fixture, saved.note.id);
      assertScrubbed(fixture, marker, true);
      test.assert.strictEqual(
        fixture.context.db.orm
          .select()
          .from(s.page_transform_requests)
          .where(eq(s.page_transform_requests.id, saved.request.id))
          .get()?.result_version_id,
        receipt.result_version_id
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* (yield* Pages).version({
            id: receipt.result_version_id!
          });

          test.assert.ok(result.status === 'published');
          test.assert.ok(
            JSON.stringify(result.document, (_, value) =>
              typeof value === 'bigint' ? String(value) : value
            ).includes('INTENTIONAL_PUBLISHED_COPY_8')
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      const libraryEvent = fixture.context.db.orm
        .select()
        .from(s.workflowEvents)
        .where(eq(s.workflowEvents.type, 'PagePublished'))
        .all()
        .find((row) => row.correlationId === saved.request.id);

      test.assert.ok(libraryEvent);
      test.assert.ok(libraryEvent.payload === '{}');

      test.expect(await libraryState(fixture, retainedIds)).toStrictEqual(afterDeletion);

      await fixture.reopen();

      test.expect(await libraryState(fixture, retainedIds)).toStrictEqual(afterDeletion);

      const native = workflowStore(fixture.context);

      fixture.context.db.orm
        .insert(s.workflow_executions)
        .values({
          execution_id: 'independent-library-consumer',
          workflow_tag: 'library-consumer-test',
          version: 1,
          payload: JSON.stringify({ documentVersionId: receipt.result_version_id }, (_, value) =>
            typeof value === 'bigint' ? String(value) : value
          ),
          status: 'running',
          created_at: 0n,
          updated_at: 0n
        })
        .run();
      test.assert.ok(native.execution('independent-library-consumer')?.status === 'running');
      test.assert.throws(() => native.assertPublication('completed-before-delete', 1));
      assertScrubbed(fixture, marker, true);
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'late provider response after acceptance cannot publish or repopulate native checkpoints',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);
    const marker = 'LATE_PROVIDER_SESSION_8';

    try {
      const saved = await setup(fixture, marker);
      const event = fixture.authoredEvent(saved.request.id);

      fixture.replies.push(
        { kind: 'sources', query: 'independent' },
        {
          kind: 'output',
          output: validPageTransformOutput('Late unpublished response [1]')
        }
      );
      fixture.beforeOutput(() =>
        Effect.runPromise(
          Effect.flatMap(Notes, (chats) => chats.deleteNote(saved.note.id)).pipe(
            Effect.asVoid,
            Effect.provide(fixture.domain())
          )
        )
      );
      await test
        .expect(fixture.executeAuthored(event, 'late-provider-delete'))
        .rejects.toSatisfy(() => true);
      test.assert.strictEqual(fixture.bodies.length, 2);
      await cleanup(fixture, saved.note.id);
      const request = fixture.context.db.orm
        .select()
        .from(s.page_transform_requests)
        .where(eq(s.page_transform_requests.id, saved.request.id))
        .get();

      test.assert.ok(request?.result_version_id === null);
      test.assert.strictEqual(fixture.context.db.orm.select().from(s.pages).all().length, 1);
      assertScrubbed(fixture, marker, true);

      assertScrubbed(fixture, 'Late unpublished response');

      await fixture.reopen();
      assertScrubbed(fixture, marker, true);
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'native suspended Activity state is retired without cancelling an independent library execution',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);
    const marker = 'SUSPENDED_PRIVATE_PARTIAL_8';

    try {
      const saved = await setup(fixture, marker);
      const event = fixture.authoredEvent(saved.request.id);
      const gate = DurableDeferred.make('suspended-note');
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
            const chats = yield* Notes;

            const suspendedGeneration = Effect.gen(function* () {
              yield* Activity.make({
                name: 'session-partial',
                success: Schema.String,
                execute: Effect.succeed(marker)
              });
              yield* DurableDeferred.await(gate);

              return saved.library.version.id;
            });

            yield* engine.register(pageTransformWorkflow, () => suspendedGeneration);
            yield* engine.register(independent, () =>
              DurableDeferred.await(independentGate).pipe(Effect.as('independent survived'))
            );
            yield* engine.register(noteDeletionWorkflow, noteDeletionHandler);
            yield* withTestAdmission(
              fixture.context,
              pageTransformWorkflow,
              'suspended-note-run',
              { event },
              engine.execute(pageTransformWorkflow, {
                executionId: 'suspended-note-run',
                payload: { event },
                discard: true
              })
            );
            yield* withTestAdmission(
              fixture.context,
              independent,
              'independent-run',
              { id: 'independent' },
              engine.execute(independent, {
                executionId: 'independent-run',
                payload: { id: 'independent' },
                discard: true
              })
            );

            yield* awaitNativeStatus(fixture, 'suspended-note-run', 'suspended');
            yield* awaitNativeStatus(fixture, 'independent-run', 'suspended');

            yield* chats.deleteNote(saved.note.id);
            const deletion = deletionEvent(fixture, saved.note.id);

            yield* withTestAdmission(
              fixture.context,
              noteDeletionWorkflow,
              'suspended-cleanup',
              { event: deletion },
              engine.execute(noteDeletionWorkflow, {
                executionId: 'suspended-cleanup',
                payload: { event: deletion }
              })
            );
            test.assert.ok((yield* chats.noteDeletion(saved.note.id)).status === 'completed');
            test.assert.ok(
              workflowStore(fixture.context).execution('suspended-note-run')?.status === 'cancelled'
            );
            test.assert.ok(
              workflowStore(fixture.context).execution('independent-run')?.status === 'suspended'
            );
            yield* engine.deferredDone(gate, {
              workflowName: pageTransformWorkflow._tag,
              executionId: 'suspended-note-run',
              deferredName: gate.name,
              exit: Exit.void
            });
            test.assert.strictEqual(
              workflowStore(fixture.context).retired('suspended-note-run'),
              true
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
      await fixture.reopen();
      assertScrubbed(fixture, marker, true);
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'kept and applied authored results preserve independent proposals and receipts after raw note deletion',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);
    const marker = 'PROPOSAL_ONLY_SESSION_8';

    try {
      const saved = await setup(fixture, marker, true);

      fixture.replies.push(
        { kind: 'sources', query: 'independent' },
        {
          kind: 'output',
          output: validPageTransformOutput('Retained edited result [1]')
        }
      );
      await fixture.executeAuthored(
        fixture.authoredEvent(saved.request.id),
        'proposal-before-delete'
      );
      const retained = await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;
          const keep = yield* chats.keepPageProposal({
            requestId: saved.request.id,
            key: 'keep-before-delete',
            title: 'Independent kept copy'
          });
          const applyValue = {
            requestId: saved.request.id,
            key: 'apply-before-delete',
            expectedVersionId: saved.library.version.id
          };
          const apply = yield* chats.applyPageProposal(applyValue);

          test.assert.ok(apply.outcome === 'applied');
          yield* chats.deleteNote(saved.note.id);

          return { keep, apply, applyValue };
        }).pipe(Effect.provide(fixture.domain()))
      );

      const retainedProposal = fixture.context.db.orm.select().from(s.page_proposals).all();
      const retainedReceipts = fixture.context.db.orm.select().from(s.page_proposal_receipts).all();

      await cleanup(fixture, saved.note.id);
      test
        .expect(fixture.context.db.orm.select().from(s.page_proposals).all())
        .toStrictEqual(retainedProposal);
      test
        .expect(fixture.context.db.orm.select().from(s.page_proposal_receipts).all())
        .toStrictEqual(retainedReceipts);
      test.assert.ok(
        fixture.context.db.orm
          .select()
          .from(s.page_versions)
          .where(eq(s.page_versions.id, retained.apply.proposedVersionId))
          .get()?.status === 'draft'
      );
      assertScrubbed(fixture, marker, true);
      await fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;
          const documents = yield* Pages;

          for (const id of [
            retained.keep.resultVersionId!,
            retained.apply.resultVersionId!,
            saved.library.version.id
          ])
            test.assert.ok((yield* documents.version({ id })).status === 'published');

          const kept = yield* chats.keepPageProposal({
            requestId: saved.request.id,
            key: 'keep-before-delete',
            title: 'Independent kept copy'
          });
          const applied = yield* chats.applyPageProposal(retained.applyValue);

          test.expect(kept).toStrictEqual({ ...retained.keep, replayed: true });
          test.expect(applied).toStrictEqual({ ...retained.apply, replayed: true });
          test.assert.ok(
            (yield* Effect.flip(
              chats.keepPageProposal({
                requestId: saved.request.id,
                key: 'new-after-delete',
                title: 'Late copy'
              })
            )).kind === 'not_found'
          );
          test.assert.strictEqual(
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
