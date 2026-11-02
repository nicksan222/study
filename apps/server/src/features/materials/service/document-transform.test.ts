/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises native session transformation requests and atomic derivative             │
 * │ publication.                                                                             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers exact snapshots, rollback, cancellation and retained library outputs.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use migrated SQLite and native publication ownership without remote providers.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import type { materialGenerationPublicationSchema } from '@study/contracts/materials/schemas';
import { createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { materialRpcHandlers } from '#testing/material-rpc';
import { withTestPublication } from '#testing/publication';

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

const paragraph = (text: string) =>
  createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] });

test('quick-session RPC captures exact ranges and publishes one independent derivative atomically', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const domain = Layer.mergeAll(
    Materials.layer,
    Conversations.layer,
    Settings.layer,
    Projects.layer
  ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));
  const handlers = materialRpcHandlers.pipe(Layer.provide(domain));

  try {
    const setup = await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const conversations = yield* Conversations;
        const collection = yield* (yield* Projects).createProject({ name: 'Inputs' });
        const session = yield* conversations.createSession({ title: 'Quick' });
        const block = paragraph('private before alpha selected private after');
        const original = yield* materials.create({
          title: 'Original',
          projectId: collection.id,
          content: { kind: 'document', blocks: [block, paragraph('alpha selected')], meta },
          publish: true
        });
        const versionId = original.version.id;

        yield* conversations.updateSessionSelection({
          sessionId: session.id,
          expectedRevision: 0n,
          targets: [{ versionId, scope: { kind: 'document' } }]
        });
        const whole = yield* conversations.captureSessionContext({
          sessionId: session.id,
          intentKey: 'whole',
          instruction: 'Read',
          preferences: {}
        });
        const documentId = whole.inputs[0]!.documentId;

        yield* conversations.updateSessionSelection({
          sessionId: session.id,
          expectedRevision: 1n,
          targets: [{ versionId, documentId, scope: { kind: 'blocks', blockIds: [block.id] } }]
        });
        const selectedBlock = yield* conversations.captureSessionContext({
          sessionId: session.id,
          intentKey: 'block',
          instruction: 'Read',
          preferences: {}
        });

        assert.equal(selectedBlock.inputs[0]!.excerpts[0]!.blockId, block.id);
        yield* conversations.updateSessionSelection({
          sessionId: session.id,
          expectedRevision: 2n,
          targets: [
            {
              versionId,
              documentId,
              scope: {
                kind: 'ranges',
                ranges: [{ versionId, documentId, blockId: block.id, start: 15, end: 29 }]
              }
            }
          ]
        });
        const capture = yield* conversations.captureSessionContext({
          sessionId: session.id,
          intentKey: 'range',
          instruction: 'Keep qualifiers',
          preferences: { language: 'italian', detail: 'brief' }
        });

        return { session, block, original, versionId, capture, collection };
      }).pipe(Effect.provide(domain))
    );
    const requestInput = {
      contextRequestId: setup.capture.requestId,
      title: 'Derivative',
      operations: ['clarity', 'summarize'] as const
    };
    const request = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const first = yield* client('materials.requestDocumentTransform', requestInput);
          const replay = yield* client('materials.requestDocumentTransform', requestInput);

          assert.equal(first.id, replay.id);
          assert.equal(first.projectId, undefined);
          assert.equal(
            (yield* Effect.flip(
              client('materials.requestDocumentTransform', { ...requestInput, title: 'Changed' })
            )).kind,
            'invalid_input'
          );

          return first;
        }).pipe(Effect.provide(handlers))
      )
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const chats = yield* Conversations;
        const materials = yield* Materials;

        yield* chats.updateSessionSelection({
          sessionId: setup.session.id,
          expectedRevision: 3n,
          targets: []
        });
        yield* materials.createVersion({
          materialId: setup.original.id,
          content: { kind: 'document', blocks: [paragraph('new secret content')], meta },
          publish: true
        });
        yield* (yield* Projects).deleteProject({ id: setup.collection.id });
        const retained = yield* (yield* Conversations).documentTransformContext({
          requestId: request.id
        });

        assert.equal(retained.inputs[0]!.excerpts[0]!.text, 'alpha selected');
        assert.deepEqual(retained.preferences, { language: 'italian', detail: 'brief' });
      }).pipe(Effect.provide(domain))
    );
    const output = paragraph('Sintesi [1]');
    const publication: typeof materialGenerationPublicationSchema.Type = {
      requestId: request.id,
      content: { kind: 'document', blocks: [output], meta },
      citations: [
        {
          marker: 1n,
          inputVersionId: setup.versionId,
          blockOrdinal: 0,
          quote: 'alpha selected',
          target: {
            versionId: setup.versionId,
            documentId: setup.capture.inputs[0]!.documentId,
            blockId: setup.block.id,
            start: 15,
            end: 29
          }
        }
      ],
      report: {
        notes: [
          { kind: 'omission', explanation: 'Selected details condensed', blockIds: [output.id] }
        ]
      }
    };
    const publish = (value: typeof publication) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* withTestPublication(
            context,
            (yield* Conversations).publishDocumentTransform(value).pipe(Effect.asVoid)
          );
        }).pipe(Effect.provide(domain))
      );
    const before = context.db.orm.select().from(s.materials).all().length;

    await assert.rejects(
      publish({
        ...publication,
        citations: [{ ...publication.citations[0]!, quote: 'private before' }]
      })
    );
    await assert.rejects(
      publish({
        ...publication,
        content: { kind: 'document', blocks: [{ ...output, id: setup.block.id }], meta }
      })
    );
    context.db.orm.run(
      sql`CREATE TRIGGER reject_transform_event BEFORE INSERT ON workflow_events WHEN NEW.type='MaterialPublished' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`
    );
    await assert.rejects(publish(publication));
    assert.equal(context.db.orm.select().from(s.materials).all().length, before);
    context.db.orm.run(sql`DROP TRIGGER reject_transform_event`);
    await publish(publication);
    await publish(publication);
    assert.equal(context.db.orm.select().from(s.materials).all().length, before + 1);
    await assert.rejects(
      publish({
        ...publication,
        report: { notes: [{ kind: 'limit', explanation: 'Different', blockIds: [] }] }
      })
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const result = yield* materials.materialGeneration({
          requestId: request.id,
          verifyOnly: true
        });

        assert.ok(result.resultVersionId);
        assert.deepEqual(result.report, publication.report);
        const derivative = yield* materials.materialVersion({ id: result.resultVersionId });

        assert.deepEqual(derivative.inputs, [setup.versionId]);
        assert.equal(derivative.content.kind, 'document');
        assert.deepEqual(
          (yield* materials.material({ id: derivative.material_id })).projectIds,
          []
        );
        assert.deepEqual(
          (yield* materials.materialVersion({ id: setup.versionId })).content,
          setup.original.version.content
        );
        assert.equal(
          (yield* materials.materials({ sessionId: setup.session.id, archived: false, limit: 10 }))
            .items.length,
          1
        );

        for (const status of ['running', 'cancelled'] as const) {
          context.db.orm
            .insert(s.workflow_executions)
            .values({
              execution_id: `publication-won-${status}`,
              workflow_tag: 'material-generation/v1',
              version: 1,
              payload: JSON.stringify({ event: { correlationId: request.id } }),
              status,
              result: status === 'running' ? JSON.stringify('__interrupt_safe__') : null,
              created_at: 1n,
              updated_at: 1n
            })
            .run();
          const read = yield* materials.materialGeneration({
            requestId: request.id,
            verifyOnly: true
          });

          assert.equal(read.cancelled, false);
          assert.equal(read.resultVersionId, result.resultVersionId);
        }

        const cancelled = yield* materials.cancelMaterialGeneration({ requestId: request.id });

        assert.equal(cancelled.cancelled, false);
        assert.equal(cancelled.resultVersionId, result.resultVersionId);
        yield* (yield* Conversations).deleteSession(setup.session.id);
        assert.equal(
          (yield* materials.materialVersion({ id: result.resultVersionId })).id,
          result.resultVersionId
        );
        assert.deepEqual(
          (yield* materials.citations({ id: result.resultVersionId, limit: 10 })).items[0]?.target,
          publication.citations[0]!.target
        );
      }).pipe(Effect.provide(domain))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('cancelled and deleted session captures reject retries and late publication without saved output', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const domain = Layer.mergeAll(
    Materials.layer,
    Conversations.layer,
    Settings.layer,
    Projects.layer
  ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const chats = yield* Conversations;

        for (const mode of ['cancel', 'delete'] as const) {
          const session = yield* chats.createSession({ title: mode });

          yield* chats.postMessage({
            sessionId: session.id,
            text: 'Conversation input',
            requestReply: false
          });
          const capture = yield* chats.captureSessionContext({
            sessionId: session.id,
            intentKey: mode,
            instruction: 'Explain',
            preferences: {}
          });
          const request = yield* (yield* Conversations).requestDocumentTransform({
            contextRequestId: capture.requestId,
            title: mode,
            operations: ['explain']
          });

          if (mode === 'cancel') {
            const cancelled = yield* materials.cancelMaterialGeneration({ requestId: request.id });

            assert.equal(cancelled.cancelled, true);
            const persisted = context.db.orm.get<{ cancelled: bigint }>(
              sql`SELECT cancelled FROM material_generation_requests WHERE id = ${request.id}`
            );

            assert.equal(persisted?.cancelled, 1n);
            const duplicate = yield* chats.requestDocumentTransform({
              contextRequestId: capture.requestId,
              title: mode,
              operations: ['explain']
            });

            assert.equal(duplicate.id, request.id);
            assert.equal(
              (yield* materials.materialGeneration({ requestId: request.id, verifyOnly: true }))
                .cancelled,
              true
            );
          } else yield* chats.deleteSession(session.id);

          assert.equal(
            (yield* Effect.flip(
              (yield* Conversations).retryDocumentTransform({
                requestId: request.id,
                retryId: mode + '-retry'
              })
            )).kind,
            mode === 'cancel' ? 'cancelled' : 'not_found'
          );
          const output = paragraph('Useful but late');
          const failure = yield* Effect.flip(
            withTestPublication(
              context,
              (yield* Conversations)
                .publishDocumentTransform({
                  requestId: request.id,
                  content: { kind: 'document', blocks: [output], meta },
                  citations: [],
                  report: {
                    notes: [{ kind: 'addition', explanation: 'Explanation', blockIds: [output.id] }]
                  }
                })
                .pipe(Effect.asVoid)
            )
          );

          assert.equal(failure.kind, mode === 'cancel' ? 'cancelled' : 'not_found');
        }

        assert.equal((yield* materials.materials({ archived: false, limit: 10 })).items.length, 0);
      }).pipe(Effect.provide(domain))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
