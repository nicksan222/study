/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises exact Material deletion through migrated SQLite, native RPC and native   │
 * │ Workflow.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { plainBlock, createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect, Layer, Schema, Exit } from 'effect';
import { RpcTest } from 'effect/rpc';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import {
  materialDeletionWorkflow,
  materialDeletionHandler
} from '#server/features/materials/workflows/deletion';
import { materialGenerationWorkflow } from '#server/features/materials/workflows/generation';
import { Recordings } from '#server/features/recordings/index';
import {
  recordingPostWorkflow,
  recordingPostHandler
} from '#server/features/recordings/workflows/index';
import { Sources } from '#server/features/sources/index';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowStore } from '#server/platform/workflows/store';
import { documentTransformFixture } from '#testing/document-transform';
import {
  acceptMaterialDeletion,
  cleanupMaterial,
  materialDeletionEvent
} from '#testing/material-deletion';
import { withTestPublication } from '#testing/publication';
import {
  setup,
  assertScrubbed,
  validDocumentTransformOutput,
  awaitNativeStatus
} from '#testing/session-deletion';

const meta = {
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

const content = (text: string) => ({
  kind: 'document' as const,
  blocks: [plainBlock('paragraph', text, { type: 'authored' })],
  meta
});

testStable(
  'native RPC deletes only explicit descendants and preserves exact missing evidence and unselected copies',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const root = yield* m.createManualDocument({
            title: 'Root',
            document: content('ORIGINAL_DELETE_ONLY'),
            createKey: 'root-document-creation'
          });

          yield* m.updateDescription({
            id: root.id,
            description: 'PRIVATE_DESCRIPTION_DELETE_ONLY',
            expectedDescription: null
          });

          const selected = yield* m.create({
            title: 'Selected',
            content: content('SELECTED_DELETE_ONLY'),
            inputs: [root.version.id],
            publish: true
          });

          const kept = yield* m.create({
            title: 'Kept',
            content: content('Intentional copied derivative'),
            inputs: [selected.version.id],
            publish: false
          });

          yield* m.setCitations({
            id: kept.version.id,
            citations: [
              {
                marker: 1n,
                inputVersionId: selected.version.id,
                anchor: { type: 'authored' },
                quote: 'SELECTED'
              }
            ]
          });

          yield* m.publishVersion({ id: kept.version.id });

          const keptPublished = yield* m.material({ id: kept.id });

          const unrelated = yield* m.create({
            title: 'Unrelated',
            content: content('Unrelated bytes'),
            publish: true
          });

          return { root, selected, kept: keptPublished, unrelated };
        }).pipe(Effect.provide(f.domain()))
      );

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

            const p = yield* client('materials.previewDeletion', { materialId: saved.root.id });

            assert.deepEqual(new Set(p.descendants), new Set([saved.selected.id, saved.kept.id]));

            const input = {
              materialId: saved.root.id,
              descendantIds: [saved.selected.id],
              token: p.token
            };

            const accepted = yield* client('materials.requestDeletion', input);

            assert.equal(accepted.status, 'pending');

            assert.deepEqual(yield* client('materials.requestDeletion', input), accepted);

            assert.equal(
              (yield* Effect.flip(
                client('materials.materialVersion', { id: saved.root.version.id })
              )).kind,
              'not_found'
            );

            assert.equal(
              (yield* Effect.flip(
                client('materials.requestDeletion', { ...input, descendantIds: [saved.kept.id] })
              )).kind,
              'invalid_input'
            );
          }).pipe(Effect.provide(MaterialsRpcLive.pipe(Layer.provideMerge(f.domain()))))
        )
      );

      f.reopen();

      await cleanupMaterial(f, saved.root.id);

      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          assert.deepEqual((yield* m.material({ id: saved.kept.id })).version, saved.kept.version);

          assert.deepEqual(yield* m.material({ id: saved.unrelated.id }), saved.unrelated);

          const evidence = yield* m.resolveEvidence({
            kind: 'anchor',
            versionId: saved.selected.version.id,
            anchor: { type: 'authored' },
            quote: 'historic kept copy'
          });

          assert.equal(evidence.availability, 'unavailable');

          assert.equal(evidence.reference.kind, 'anchor');

          if (evidence.reference.kind === 'anchor')
            assert.equal(evidence.reference.versionId, saved.selected.version.id);

          const citations = yield* m.citations({ id: saved.kept.version.id, limit: 10 });

          assert.equal(citations.items[0]?.evidence?.availability, 'unavailable');

          assert.equal(citations.items[0]?.inputVersionId, saved.selected.version.id);

          const dependencies = yield* m.dependencyStatus({
            id: saved.selected.version.id,
            limit: 10
          });

          assert.equal(dependencies.items[0]?.state, 'unavailable');

          assert.equal((yield* m.deletion({ materialId: saved.selected.id })).status, 'completed');

          assert.deepEqual(
            (yield* m.materials({ archived: false, limit: 20 })).items.map((x) => x.id).sort(),
            [saved.kept.id, saved.unrelated.id].sort()
          );
        }).pipe(Effect.provide(f.domain()))
      );

      assertScrubbed(f, 'ORIGINAL_DELETE_ONLY');
      assertScrubbed(f, 'PRIVATE_DESCRIPTION_DELETE_ONLY');

      assertScrubbed(f, 'SELECTED_DELETE_ONLY');
    } finally {
      await f.close();
    }
  }
);

testStable(
  'preview rejects unrelated and duplicate scope, new descendants and newly captured private context',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await setup(f, 'PRIVATE_PREVIEW_MARKER');

      await Effect.runPromise(
        withTestPublication(
          f.context,
          Effect.flatMap(Conversations, (conversations) =>
            conversations.abandonReply(saved.pending)
          ).pipe(Effect.asVoid, Effect.provide(f.domain()))
        ).pipe(Effect.provide(f.domain()))
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const p = yield* m.previewDeletion({ materialId: saved.library.id });

          const other = yield* m.create({
            title: 'Other',
            content: content('Other'),
            publish: true
          });

          for (const ids of [[other.id], [saved.library.id]])
            assert.equal(
              (yield* Effect.flip(
                m.requestDeletion({
                  materialId: saved.library.id,
                  token: p.token,
                  descendantIds: ids
                })
              )).kind,
              'invalid_input'
            );

          const p2 = yield* m.previewDeletion({ materialId: saved.library.id });

          yield* (yield* Conversations).captureSessionContext({
            sessionId: saved.session.id,
            intentKey: 'new-private-capture',
            instruction: 'New instruction',
            preferences: {}
          });

          assert.equal(
            (yield* Effect.flip(
              m.requestDeletion({
                materialId: saved.library.id,
                token: p2.token,
                descendantIds: []
              })
            )).kind,
            'invalid_input'
          );

          const p3 = yield* m.previewDeletion({ materialId: saved.library.id });

          yield* m.create({
            title: 'Late descendant',
            content: content('Late'),
            inputs: [saved.library.version.id],
            publish: true
          });

          assert.equal(
            (yield* Effect.flip(
              m.requestDeletion({
                materialId: saved.library.id,
                token: p3.token,
                descendantIds: []
              })
            )).kind,
            'invalid_input'
          );
        }).pipe(Effect.provide(f.domain()))
      );

      assert.equal(f.context.db.orm.select().from(s.material_deletions).all().length, 0);
    } finally {
      await f.close();
    }
  }
);

testStable('barrier and outbox roll back together on event persistence failure', async () => {
  const f = await documentTransformFixture();

  try {
    const saved = await setup(f, 'ROLLBACK_PRIVATE');

    f.context.db.orm.run(
      sql.raw(
        `CREATE TRIGGER reject_material_intent BEFORE INSERT ON workflow_events WHEN NEW.type='MaterialDeletionRequested' BEGIN SELECT RAISE(ABORT,'injected'); END`
      )
    );

    await assert.rejects(acceptMaterialDeletion(f, saved.library.id));

    assert.equal(f.context.db.orm.select().from(s.material_deletions).all().length, 0);

    assert.equal(f.context.db.orm.select().from(s.material_deletion_members).all().length, 0);

    assert.equal(f.context.db.orm.select().from(s.material_deletion_requests).all().length, 0);

    await Effect.runPromise(
      Effect.gen(function* () {
        assert.equal(
          (yield* (yield* Conversations).sessionSelection({ sessionId: saved.session.id })).targets
            .length,
          1
        );
      }).pipe(Effect.provide(f.domain()))
    );
  } finally {
    await f.close();
  }
});

testStable(
  'private captures scrub without deleting sessions, messages or unrelated title work',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await setup(f, 'CAPTURE_ONLY_MARKER');

      const before = await Effect.runPromise(
        Effect.flatMap(Conversations, (c) =>
          c.thread({ sessionId: saved.session.id, limit: 20 })
        ).pipe(Effect.provide(f.domain()))
      );

      await acceptMaterialDeletion(f, saved.library.id);

      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;

          assert.equal(
            (yield* c.sessionSelection({ sessionId: saved.session.id })).targets.length,
            0
          );

          assert.equal(
            (yield* Effect.flip(c.sessionContext({ requestId: saved.capture.requestId }))).kind,
            'not_found'
          );

          assert.equal(
            (yield* Effect.flip(
              (yield* Materials).materialGeneration({
                requestId: saved.request.id,
                verifyOnly: true
              })
            )).kind,
            'not_found'
          );
        }).pipe(Effect.provide(f.domain()))
      );

      await cleanupMaterial(f, saved.library.id);

      const after = await Effect.runPromise(
        Effect.flatMap(Conversations, (c) =>
          c.thread({ sessionId: saved.session.id, limit: 20 })
        ).pipe(Effect.provide(f.domain()))
      );

      assert.deepEqual(after, {
        ...before,
        items: before.items.filter((message) =>
          message.versions.some((version) => version.status === 'complete')
        )
      });

      assert.equal(f.context.db.orm.select().from(s.sessions).all().length, 2);

      assert.equal(f.context.db.orm.select().from(s.session_run_contexts).all().length, 0);

      assert.equal(f.context.db.orm.select().from(s.conversation_reply_requests).all().length, 0);

      assert.ok(
        f.context.db.orm
          .select()
          .from(s.workflowEvents)
          .where(eq(s.workflowEvents.type, 'ConversationTitleRequested'))
          .all()
          .some((e) => e.payload.includes('CAPTURE_ONLY_MARKER'))
      );
    } finally {
      await f.close();
    }
  }
);

for (const doubleFailure of [false, true])
  testStable(
    `failed cleanup retries after restart and fences stale completion (failure settlement blocked=${doubleFailure})`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const root = await Effect.runPromise(
          Effect.flatMap(Materials, (m) =>
            m.create({ title: 'Root', content: content('RETRY_CLEANUP_MARKER'), publish: true })
          ).pipe(Effect.provide(f.domain()))
        );

        const accepted = await acceptMaterialDeletion(f, root.id);

        f.context.db.orm.run(
          sql.raw(
            `CREATE TRIGGER reject_material_scrub BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT,'injected'); END`
          )
        );

        if (doubleFailure)
          f.context.db.orm.run(
            sql.raw(
              `CREATE TRIGGER reject_material_failure BEFORE UPDATE ON material_deletions WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'injected'); END`
            )
          );

        await cleanupMaterial(f, root.id).catch(() => undefined);

        const failed = await Effect.runPromise(
          Effect.flatMap(Materials, (m) => m.deletion({ materialId: root.id })).pipe(
            Effect.provide(f.domain())
          )
        );

        assert.equal(failed.status, doubleFailure ? 'pending' : 'failed');

        await Effect.runPromise(
          awaitNativeStatus(f, `material-cleanup/${accepted.operationId}/1`, 'completed')
        );

        assert.equal(
          workflowStore(f.context).execution(`material-cleanup/${accepted.operationId}/1`)!.status,
          'completed'
        );

        f.context.db.orm.run(sql.raw('DROP TRIGGER reject_material_scrub'));

        if (doubleFailure) f.context.db.orm.run(sql.raw('DROP TRIGGER reject_material_failure'));

        f.reopen();

        await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;

            const retry = yield* m.retryDeletion({ materialId: root.id });

            assert.equal(retry.attempt, 2);

            const stale = yield* m.failMaterialDeletion({
              materialId: root.id,
              attempt: 1,
              errorKind: 'internal'
            });

            assert.equal(stale.status, 'pending');

            assert.equal(stale.attempt, 2);
          }).pipe(Effect.provide(f.domain()))
        );

        assert.equal(materialDeletionEvent(f, root.id).attempt, 2);

        await cleanupMaterial(f, root.id);

        assertScrubbed(f, 'RETRY_CLEANUP_MARKER');

        await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;

            const completed = yield* m.deletion({ materialId: root.id });

            assert.equal(completed.status, 'completed');

            assert.deepEqual(yield* m.retryDeletion({ materialId: root.id }), completed);
          }).pipe(Effect.provide(f.domain()))
        );
      } finally {
        await f.close();
      }
    }
  );

testStable(
  'managed image revision survives the original and disappears after the last retained Document is deleted',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const source = yield* (yield* Sources).createSource({
            name: 'private-image.png',
            projectId: null,
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          });

          const m = yield* Materials;

          const original = (yield* m.materials({ limit: 20, archived: false })).items.find(
            (x) => x.importProcessing?.sourceId === source.id
          )!;

          const derivative = yield* m.create({
            title: 'Retained image',
            publish: true,
            content: {
              kind: 'document',
              blocks: [
                createBlock({
                  type: 'image',
                  sourceId: source.id,
                  revision: 1,
                  alt: 'Intentionally kept image'
                })
              ],
              meta
            }
          });

          return { source, original, derivative };
        }).pipe(Effect.provide(f.domain()))
      );

      const accepted = await acceptMaterialDeletion(f, saved.original.id);

      await cleanupMaterial(f, saved.original.id);

      assert.equal(f.context.db.orm.select().from(s.source_blobs).all().length, 0);

      assert.equal(f.context.db.orm.select().from(s.source_snapshots).all().length, 1);

      const retainedRevision = f.context.db.orm.select().from(s.source_snapshots).get();

      assert.ok(retainedRevision);

      assert.deepEqual(
        new Uint8Array(retainedRevision.bytes),
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      );

      f.reopen();

      await Effect.runPromise(
        Effect.gen(function* () {
          assert.deepEqual(
            (yield* (yield* Materials).material({ id: saved.derivative.id })).version,
            saved.derivative.version
          );
        }).pipe(Effect.provide(f.domain()))
      );

      assert.equal(accepted.materialIds.length, 1);

      await acceptMaterialDeletion(f, saved.derivative.id);

      await cleanupMaterial(f, saved.derivative.id);

      assert.equal(f.context.db.orm.select().from(s.document_assets).all().length, 0);

      assert.equal(f.context.db.orm.select().from(s.source_snapshots).all().length, 0);

      assert.equal(
        f.context.db.orm.select().from(s.source_material_deletion_assets).all().length,
        2
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'a dependent native generation completing after the barrier cannot publish or restart',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await setup(f, 'LATE_GENERATION_PRIVATE');

      const event = f.event(saved.request.id);

      f.replies.push({
        kind: 'output',
        output: validDocumentTransformOutput('MUST_NOT_PUBLISH_AFTER_BARRIER')
      });

      f.beforeResponse(async () => {
        await acceptMaterialDeletion(f, saved.library.id);
      });

      await f.execute(event, 'late-material-generation').catch(() => undefined);

      await cleanupMaterial(f, saved.library.id);

      assertScrubbed(f, 'MUST_NOT_PUBLISH_AFTER_BARRIER');

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.material_generation_requests)
          .where(eq(s.material_generation_requests.id, saved.request.id))
          .get()?.payload,
        '{}'
      );

      await assert.rejects(f.execute(event, 'resurrect-retired-generation'));
    } finally {
      await f.close();
    }
  }
);

testStable(
  'native retirement rejects late checkpoints and deferred delivery while unrelated execution survives',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await setup(f, 'SESSION_MESSAGE_RETAINED');

      const event = f.event(saved.request.id);

      const gate = DurableDeferred.make('private-material-gate');

      const independentGate = DurableDeferred.make('independent-material-gate');

      const independent = Workflow.make('independent-material-deletion-test', {
        payload: { id: Schema.String },
        idempotencyKey: ({ id }) => id,
        success: Schema.String
      });

      const pausedGeneration = Effect.gen(function* () {
        yield* Activity.make({
          name: 'private-material-partial',
          success: Schema.String,
          execute: Effect.succeed('PRIVATE_NATIVE_CHECKPOINT_DELETE')
        });

        yield* DurableDeferred.await(gate);

        return saved.library.version.id;
      });

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            const m = yield* Materials;

            yield* engine.register(materialGenerationWorkflow, () => pausedGeneration);

            yield* engine.register(independent, () =>
              DurableDeferred.await(independentGate).pipe(Effect.as('kept'))
            );

            yield* engine.register(materialDeletionWorkflow, materialDeletionHandler);

            yield* engine.execute(materialGenerationWorkflow, {
              executionId: 'retire-material-run',
              payload: { event },
              discard: true
            });

            yield* engine.execute(independent, {
              executionId: 'keep-material-run',
              payload: { id: 'keep' },
              discard: true
            });

            yield* awaitNativeStatus(f, 'retire-material-run', 'suspended');

            yield* awaitNativeStatus(f, 'keep-material-run', 'suspended');

            const p = yield* m.previewDeletion({ materialId: saved.library.id });

            yield* m.requestDeletion({
              materialId: saved.library.id,
              token: p.token,
              descendantIds: []
            });

            const deletion = materialDeletionEvent(f, saved.library.id);

            yield* engine.execute(materialDeletionWorkflow, {
              executionId: 'material-native-cleanup',
              payload: { event: deletion }
            });

            assert.equal((yield* m.deletion({ materialId: saved.library.id })).status, 'completed');

            assert.equal(
              workflowStore(f.context).execution('retire-material-run')?.status,
              'cancelled'
            );

            assert.equal(
              workflowStore(f.context).execution('keep-material-run')?.status,
              'suspended'
            );

            yield* engine.deferredDone(gate, {
              workflowName: materialGenerationWorkflow._tag,
              executionId: 'retire-material-run',
              deferredName: gate.name,
              exit: Exit.void
            });

            assert.equal(
              workflowStore(f.context).deferred('retire-material-run', gate.name),
              undefined
            );

            yield* engine.deferredDone(independentGate, {
              workflowName: independent._tag,
              executionId: 'keep-material-run',
              deferredName: independentGate.name,
              exit: Exit.void
            });

            yield* awaitNativeStatus(f, 'keep-material-run', 'completed');

            assertScrubbed(f, 'PRIVATE_NATIVE_CHECKPOINT_DELETE');
          }).pipe(Effect.provide(f.services()))
        )
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'generated output committed before acceptance retains copied text after input cleanup',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await setup(f, 'PRIVATE_GENERATED_CONTEXT');

      f.replies.push(
        { kind: 'sources', query: 'Independent library evidence' },
        { kind: 'output', output: validDocumentTransformOutput('INTENTIONAL_PUBLISHED_COPY [1]') }
      );

      await f.execute(f.event(saved.request.id), 'completed-before-material-deletion');

      const kept = await Effect.runPromise(
        Effect.flatMap(Materials, (m) =>
          m.materialGeneration({ requestId: saved.request.id, verifyOnly: true })
        ).pipe(Effect.provide(f.domain()))
      );

      const versionId = kept.resultVersionId;

      assert.ok(versionId !== null);

      const version = await Effect.runPromise(
        Effect.flatMap(Materials, (m) => m.materialVersion({ id: versionId })).pipe(
          Effect.provide(f.domain())
        )
      );

      await acceptMaterialDeletion(f, saved.library.id);

      await cleanupMaterial(f, saved.library.id);

      f.reopen();

      const retained = await Effect.runPromise(
        Effect.flatMap(Materials, (m) => m.materialVersion({ id: versionId })).pipe(
          Effect.provide(f.domain())
        )
      );

      assert.deepEqual(retained, version);

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.material_generation_requests)
          .where(eq(s.material_generation_requests.id, saved.request.id))
          .get()?.payload,
        '{}'
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'deleting an original fences stale extraction and removes only its exact bytes, including equal-hash independence',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;

          const bytes = new TextEncoder().encode('EXCLUSIVE_SOURCE_DELETE_MARKER');

          const first = yield* sources.createSource({ name: 'delete.txt', projectId: null, bytes });

          const second = yield* sources.createSource({ name: 'keep.txt', projectId: null, bytes });

          const m = yield* Materials;

          const root = (yield* m.materials({ archived: false, limit: 20 })).items.find(
            (m) => m.importProcessing?.sourceId === first.id
          )!;

          return { first, second, root, bytes };
        }).pipe(Effect.provide(f.domain()))
      );

      const event = f.context.db.orm
        .select()
        .from(s.workflowEvents)
        .where(eq(s.workflowEvents.type, 'SourceProcessingRequested'))
        .all()
        .map((e) => decodeEvent(e.payload))
        .find((e) => e.type === 'SourceProcessingRequested' && e.sourceId === saved.first.id);

      assert.ok(event?.type === 'SourceProcessingRequested');

      await acceptMaterialDeletion(f, saved.root.id);

      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;

          const failure = yield* withTestPublication(
            f.context,
            sources.publishSourceDocument({
              event,
              document: { meta, blocks: content('LATE_SOURCE_DECODE_CONTENT').blocks }
            })
          ).pipe(Effect.flip);

          assert.equal(failure.kind, 'not_found');

          assert.equal(
            (yield* Effect.flip(sources.sourceSnapshot({ id: saved.first.id, revision: 1 }))).kind,
            'not_found'
          );
        }).pipe(Effect.provide(f.domain()))
      );

      await cleanupMaterial(f, saved.root.id);

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.source_blobs)
          .where(eq(s.source_blobs.source_id, saved.first.id))
          .all().length,
        0
      );

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.source_snapshots)
          .where(eq(s.source_snapshots.source_id, saved.first.id))
          .all().length,
        0
      );

      assert.deepEqual(
        new Uint8Array(
          f.context.db.orm
            .select()
            .from(s.source_blobs)
            .where(eq(s.source_blobs.source_id, saved.second.id))
            .get()!.bytes
        ),
        saved.bytes
      );

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.source_processing)
          .where(eq(s.source_processing.source_id, saved.second.id))
          .all().length,
        1
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'accepted input deletion blocks proposal apply and keep while retiring the unpublished proposal',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await setup(f, 'PROPOSAL_CONTEXT_RETAINED_MESSAGE', true);

      f.replies.push(
        { kind: 'sources', query: 'Independent library evidence' },
        {
          kind: 'output',
          output: validDocumentTransformOutput('PRIVATE_PROPOSAL_DELETE_MARKER [1]')
        }
      );

      await f.execute(f.event(saved.request.id), 'proposal-before-deletion');

      await acceptMaterialDeletion(f, saved.library.id);

      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;

          const keep = yield* Effect.flip(
            c.keepDocumentProposal({ requestId: saved.request.id, key: 'late-keep' })
          );

          const apply = yield* Effect.flip(
            c.applyDocumentProposal({
              requestId: saved.request.id,
              key: 'late-apply',
              expectedVersionId: saved.library.version.id,
              baseVersionId: saved.library.version.id
            })
          );

          assert.equal(keep.kind, 'not_found');

          assert.equal(apply.kind, 'not_found');
        }).pipe(Effect.provide(f.domain()))
      );

      await cleanupMaterial(f, saved.library.id);

      assert.equal(f.context.db.orm.select().from(s.document_proposals).all().length, 0);

      assertScrubbed(f, 'PRIVATE_PROPOSAL_DELETE_MARKER');
    } finally {
      await f.close();
    }
  }
);

testStable(
  'distinct Materials sharing one private capture reject overlapping retirement atomically',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await setup(f, 'OVERLAP_CAPTURE_RETAINED_MESSAGE');

      await Effect.runPromise(
        withTestPublication(
          f.context,
          Effect.flatMap(Conversations, (conversations) =>
            conversations.abandonReply(saved.pending)
          ).pipe(Effect.asVoid, Effect.provide(f.domain()))
        ).pipe(Effect.provide(f.domain()))
      );

      const other = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const second = yield* m.create({
            title: 'Second selected input',
            content: content('SECOND_INPUT_INDEPENDENT'),
            publish: true
          });

          const c = yield* Conversations;

          yield* c.updateSessionSelection({
            sessionId: saved.session.id,
            expectedRevision: 1n,
            targets: [
              { versionId: saved.library.version.id, scope: { kind: 'document' } },
              { versionId: second.version.id, scope: { kind: 'document' } }
            ]
          });

          yield* c.captureSessionContext({
            sessionId: saved.session.id,
            intentKey: 'shared-two-inputs',
            instruction: 'Shared private capture',
            preferences: {}
          });

          return second;
        }).pipe(Effect.provide(f.domain()))
      );

      await acceptMaterialDeletion(f, saved.library.id);

      await assert.rejects(acceptMaterialDeletion(f, other.id));

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.material_deletion_members)
          .where(eq(s.material_deletion_members.material_id, other.id))
          .all().length,
        0
      );

      await cleanupMaterial(f, saved.library.id);

      await acceptMaterialDeletion(f, other.id);

      await cleanupMaterial(f, other.id);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'published recording messages keep owned PCM while private WAV captures and original source bytes retire',
  async () => {
    const f = await documentTransformFixture();

    try {
      const prepared = await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;

          const r = yield* Recordings;

          const session = yield* c.createUntitledSession({});

          const recording = yield* r.createRecording(session.id);

          yield* r.appendRecording({ id: recording.id, samples: [-32768, 0, 32767] });

          const post = yield* r.postRecording({
            session: session.id,
            recording: recording.id,
            name: 'private-captured-recording.wav'
          });

          return { session, recording, post };
        }).pipe(Effect.provide(f.domain()))
      );

      const event = decodeEvent(
        f.context.db.orm
          .select()
          .from(s.workflowEvents)
          .where(eq(s.workflowEvents.eventId, prepared.post.requestId))
          .get()!.payload
      );

      assert.equal(event.type, 'RecordingPostRequested');

      if (event.type !== 'RecordingPostRequested') throw new Error('Expected recording event');

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(recordingPostWorkflow, recordingPostHandler);

            yield* engine.execute(recordingPostWorkflow, {
              executionId: 'published-recording-copy',
              payload: { event }
            });
          }).pipe(Effect.provide(f.services()))
        )
      );

      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const snapshot = yield* (yield* Recordings).recordingPostSnapshot({
            requestId: prepared.post.requestId
          });

          const root = (yield* (yield* Materials).materials({
            archived: false,
            limit: 20
          })).items.find((m) => m.importProcessing?.sourceId === snapshot.sourceId)!;

          const thread = yield* (yield* Conversations).thread({
            sessionId: prepared.session.id,
            limit: 10
          });

          return { snapshot, root, thread };
        }).pipe(Effect.provide(f.domain()))
      );

      await acceptMaterialDeletion(f, saved.root.id);

      assert.throws(() =>
        f.context.db.orm
          .update(s.recording_posts)
          .set({ name: 'unrelated mutation during cleanup' })
          .where(eq(s.recording_posts.request_id, prepared.post.requestId))
          .run()
      );

      // Import and recording publication deliberately share this correlation. The first
      // provenance must stay immutable while both feature owners clean their own rows.
      const owner = f.context.db.orm
        .select()
        .from(s.material_deletion_requests)
        .where(eq(s.material_deletion_requests.request_id, prepared.post.requestId))
        .get();

      assert.ok(owner);

      assert.equal(owner.kind, 'source');

      assert.equal(owner.deletion_id, saved.root.id);

      await cleanupMaterial(f, saved.root.id);

      f.reopen();

      const post = f.context.db.orm
        .select()
        .from(s.recording_posts)
        .where(eq(s.recording_posts.request_id, prepared.post.requestId))
        .get()!;

      assert.deepEqual(post.wav, Buffer.alloc(46));

      assert.equal(post.name, '-');

      assert.equal(post.duration_ms, 0n);

      assert.ok(
        f.context.db.orm
          .select()
          .from(s.recording_chunks)
          .where(eq(s.recording_chunks.recording_id, prepared.recording.id))
          .all().length > 0
      );

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.source_blobs)
          .where(eq(s.source_blobs.source_id, saved.snapshot.sourceId!))
          .all().length,
        0
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const r = yield* Recordings;

          assert.equal(
            (yield* Effect.flip(r.recordingPostSnapshot({ requestId: prepared.post.requestId })))
              .kind,
            'not_found'
          );

          assert.deepEqual(
            yield* (yield* Conversations).thread({ sessionId: prepared.session.id, limit: 10 }),
            saved.thread
          );
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);
