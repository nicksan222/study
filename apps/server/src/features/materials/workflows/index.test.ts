/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises source ingestion projection into published materials and confirms        │
 * │ workflow replay survives database reopen.                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Combines source ingestion and material projection workflows over persistent test       │
 * │   state.                                                                                 │
 * │ - Asserts durable effects against persisted state and replay behavior.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite drives the native workflow engine with persisted test state; it does not       │
 * │ replace production activities.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sql } from '@study/db';
import { workflowEvents } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Learning } from '#server/features/learning/service/index';
import { Materials } from '#server/features/materials/service/index';
import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import {
  sourceIngestionWorkflow,
  sourceIngestionHandler,
  sourceCorrectionWorkflow,
  sourceCorrectionHandler
} from '#server/features/sources/workflows/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';

import { sourceIndexedWorkflow, sourceIndexedHandler } from './index.ts';

test('source ingestion projects published materials and replay survives reopen', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const auth = new AuthManager({ issuer: 'http://127.0.0.1', saveRefresh: async () => {} });
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: 'http://127.0.0.1' });
  const services = () =>
    Layer.mergeAll(
      Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
      Layer.succeed(Database, { store: context }),
      Layer.mergeAll(
        Projects.layer,
        Sources.layer,
        Materials.layer,
        Learning.layer.pipe(Layer.provide(Layer.mergeAll(Materials.layer, Settings.layer)))
      ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
      agentsLayer({
        model: () => Effect.succeed(model),
        language: 'en',
        searchSources: () => Effect.succeed([])
      }),
      workflowEngineLayer(context)
    );

  try {
    const fixture = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const sources = yield* Sources;
          const other = yield* projects.createProject({ name: 'Other' });
          const source = yield* sources.createSource({
            projectId: null,
            name: 'notes.txt',
            bytes: new TextEncoder().encode('Hello')
          });
          const state = yield* sources.sourceProcessing(source.id);

          assert.ok(state.requestId);
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
          yield* engine.execute(sourceIngestionWorkflow, {
            executionId: 'ingest',
            payload: {
              event: {
                type: 'SourceProcessingRequested',
                sourceId: source.id,
                requestId: state.requestId,
                inputVersion: 1,
                eventId: 'request',
                causationId: null,
                correlationId: state.requestId,
                depth: 0
              }
            }
          });
          const row = context.db.orm
            .select()
            .from(workflowEvents)
            .all()
            .find((e) => e.type === 'SourceIndexed');

          assert.ok(row);
          const event = decodeEvent(row.payload);

          assert.equal(event.type, 'SourceIndexed');

          return { event, otherId: other.id };
        }).pipe(Effect.provide(services()))
      )
    );
    const event = fixture.event;
    const project = (executionId: string, input = event) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceIndexedWorkflow, sourceIndexedHandler);

            return yield* engine.execute(sourceIndexedWorkflow, {
              executionId,
              payload: { event: input }
            });
          }).pipe(Effect.provide(services()))
        )
      );

    await assert.rejects(project('wrong-project', { ...event, projectId: fixture.otherId }));
    context.db.orm.run(
      sql`UPDATE source_processing SET request_id = 'superseded' WHERE source_id = ${event.sourceId}`
    );
    await assert.rejects(project('stale'));
    context.db.orm.run(
      sql`UPDATE source_processing SET request_id = published_request_id WHERE source_id = ${event.sourceId}`
    );
    context.db.orm.run(
      sql`CREATE TRIGGER reject_material_event BEFORE INSERT ON workflow_events WHEN NEW.type = 'MaterialPublished' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
    );
    await assert.rejects(project('rollback'));
    assert.equal(context.db.orm.all(sql`SELECT * FROM materials`).length, 1);
    assert.equal(
      context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .filter((e) => e.type === 'MaterialPublished').length,
      1
    );
    context.db.orm.run(sql`DROP TRIGGER reject_material_event`);
    const result = await project('projection');

    assert.equal(result.original.version.kind, 'file');
    assert.equal(result.original.version.operation, 'original');
    assert.equal(result.extracted.id, result.original.id);
    assert.equal(result.extracted.version.kind, 'file');
    assert.equal(result.extracted.version.operation, 'extract');
    assert.throws(() =>
      context.db.orm.run(
        sql`UPDATE blocks SET text='tampered' WHERE document_id=${event.documentId}`
      )
    );
    assert.throws(() =>
      context.db.orm.run(
        sql`UPDATE material_source_snapshots SET document_id=NULL WHERE version_id=${result.extracted.version.id}`
      )
    );
    assert.deepEqual(result.extracted.version.inputs, [result.original.version.id]);

    if ('extracted' in result.extracted.version.content)
      assert.equal(result.extracted.version.content.extracted?.document.blocks[0]?.text, 'Hello');

    assert.equal(
      context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .filter((e) => e.type === 'MaterialPublished').length,
      2
    );
    context.close();
    context = new ServerContext(location.open());
    const replay = await project('replay');

    assert.equal(replay.original.version.id, result.original.version.id);
    assert.equal(replay.extracted.version.id, result.extracted.version.id);
    assert.equal(
      context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .filter((e) => e.type === 'MaterialPublished').length,
      2
    );
    const reindex = (executionId: string) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const state = yield* sources.requestSourceProcessing({
              id: event.sourceId,
              expectedRevision: (yield* sources.sourceProcessing(event.sourceId)).revision
            });

            assert.ok(state.requestId);
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
            yield* engine.execute(sourceIngestionWorkflow, {
              executionId,
              payload: {
                event: {
                  type: 'SourceProcessingRequested',
                  sourceId: event.sourceId,
                  requestId: state.requestId,
                  inputVersion: state.revision,
                  eventId: `${executionId}-request`,
                  causationId: null,
                  correlationId: state.requestId,
                  depth: 0
                }
              }
            });
            const rows = context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .filter((row) => row.type === 'SourceIndexed');
            const decoded = decodeEvent(rows.at(-1)!.payload);

            assert.equal(decoded.type, 'SourceIndexed');

            return decoded;
          }).pipe(Effect.provide(services()))
        )
      );

    const nextEvent = await reindex('reindex');

    await assert.rejects(project('old-document', event));
    const reindexed = await project('new-document', nextEvent);

    assert.equal(reindexed.original.version.id, result.original.version.id);
    assert.notEqual(reindexed.extracted.version.id, result.extracted.version.id);
    assert.deepEqual(reindexed.extracted.version.inputs, [result.original.version.id]);
    assert.equal(context.db.orm.all(sql`SELECT * FROM documents`).length, 2);
    assert.equal(
      context.db.orm.all(sql`SELECT * FROM material_source_snapshots WHERE document_id IS NOT NULL`)
        .length,
      2
    );
    assert.equal(
      context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .filter((e) => e.type === 'MaterialPublished').length,
      3
    );
    const pinned = await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* Sources;

        yield* sources.setSourceProject({ id: event.sourceId, projectId: fixture.otherId });
        const row = context.db.orm
          .select()
          .from(workflowEvents)
          .all()
          .filter((entry) => entry.type === 'SourceIndexed')
          .at(-1)!;
        const assigned = decodeEvent(row.payload);

        assert.equal(assigned.type, 'SourceIndexed');

        return assigned;
      }).pipe(Effect.provide(services()))
    );

    await project('collect-for-generation', pinned);
    const generation = await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const sources = yield* Sources;
        const request = yield* materials.requestMaterialGeneration({
          projectId: fixture.otherId,
          title: 'Pinned',
          kind: 'flashcards',
          inputVersionIds: [reindexed.extracted.version.id]
        });
        const before = yield* materials.materialGeneration({ requestId: request.id });
        const learning = yield* Learning;

        yield* learning.startPractice({
          projectId: fixture.otherId,
          inputVersionIds: [reindexed.extracted.version.id]
        });
        yield* learning.stopPractice({ projectId: fixture.otherId });
        const current = yield* sources.sourceDocument(event.sourceId);

        yield* sources.correctBlock({
          id: event.sourceId,
          documentId: current.id,
          ordinal: 0,
          before: 'Hello',
          after: 'Corrected'
        });
        const pending = yield* materials.material({ id: result.original.id });

        assert.equal(pending.importProcessing?.status, 'pending');
        assert.equal(
          (yield* Effect.flip(
            materials.requestMaterialGeneration({
              projectId: fixture.otherId,
              title: 'Pending original',
              kind: 'flashcards',
              inputVersionIds: [result.original.version.id]
            })
          )).kind,
          'invalid_input'
        );

        return { request, before };
      }).pipe(Effect.provide(services()))
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;
          const row = context.db.orm
            .select()
            .from(workflowEvents)
            .all()
            .filter((entry) => entry.type === 'SourceCorrectionRequested')
            .at(-1)!;
          const correction = decodeEvent(row.payload);

          assert.equal(correction.type, 'SourceCorrectionRequested');
          yield* engine.register(sourceCorrectionWorkflow, sourceCorrectionHandler);
          yield* engine.execute(sourceCorrectionWorkflow, {
            executionId: 'correct',
            payload: { event: correction }
          });
        }).pipe(Effect.provide(services()))
      )
    );
    const correctedRow = context.db.orm
      .select()
      .from(workflowEvents)
      .all()
      .filter((entry) => entry.type === 'SourceIndexed')
      .at(-1)!;
    const correctedEvent = decodeEvent(correctedRow.payload);

    assert.equal(correctedEvent.type, 'SourceIndexed');
    const corrected = await project('corrected', correctedEvent);

    assert.equal(corrected.extracted.id, result.original.id);
    assert.notEqual(corrected.extracted.version.id, reindexed.extracted.version.id);

    if ('extracted' in corrected.extracted.version.content)
      assert.equal(
        corrected.extracted.version.content.extracted?.document.blocks[0]?.text,
        'Corrected'
      );

    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const old = yield* materials.materialVersion({ id: reindexed.extracted.version.id });

        assert.ok('extracted' in old.content);
        assert.equal(old.content.extracted?.document.blocks[0]?.text, 'Hello');
        assert.deepEqual(
          (yield* materials.materialVersionExport({ id: old.id })).bytes,
          new TextEncoder().encode('Hello')
        );
        const captured = yield* materials.materialGeneration({ requestId: generation.request.id });

        assert.deepEqual(captured.documentIds, generation.before.documentIds);
        assert.deepEqual(captured.inputVersionIds, [old.id]);
        assert.equal(context.db.orm.all(sql`SELECT * FROM materials`).length, 1);
      }).pipe(Effect.provide(services()))
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;

        yield* materials.archive({ id: result.original.id });
      }).pipe(Effect.provide(services()))
    );
    const afterArchiveEvent = await reindex('reindex-after-archive');
    const afterArchive = await project('projection-after-archive', afterArchiveEvent);

    assert.equal(afterArchive.original.id, result.original.id);
    assert.deepEqual(afterArchive.extracted.version.inputs, [afterArchive.original.version.id]);
    assert.notEqual(afterArchive.original.archived_at, null);
    const archived = await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;

        return yield* materials.material({ id: result.original.id });
      }).pipe(Effect.provide(services()))
    );

    assert.notEqual(archived.archived_at, null);

    const reassignedEvent = await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* Sources;

        yield* sources.setSourceProject({ id: event.sourceId, projectId: fixture.otherId });
        const row = context.db.orm
          .select()
          .from(workflowEvents)
          .all()
          .filter((entry) => entry.type === 'SourceIndexed')
          .at(-1);

        assert.ok(row);
        const indexed = decodeEvent(row.payload);

        assert.equal(indexed.type, 'SourceIndexed');

        return indexed;
      }).pipe(Effect.provide(services()))
    );
    const reassigned = await project('reassigned', reassignedEvent);

    assert.equal(reassigned.original.id, afterArchive.original.id);
    assert.equal(reassigned.extracted.id, afterArchive.extracted.id);
    assert.equal(reassigned.original.version.id, afterArchive.original.version.id);
    assert.equal(reassigned.extracted.version.id, afterArchive.extracted.version.id);
    assert.ok(reassigned.original.projectIds.includes(fixture.otherId));
    assert.ok(reassigned.extracted.projectIds.includes(fixture.otherId));
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const projects = yield* Projects;

        yield* materials.unarchive({ id: reassigned.original.id });
        const listed = yield* materials.materials({
          projectId: fixture.otherId,
          archived: false,
          limit: 10
        });

        assert.deepEqual(
          new Set(listed.items.map((item) => item.id)),
          new Set([reassigned.original.id, reassigned.extracted.id])
        );
        yield* materials.requestMaterialGeneration({
          projectId: fixture.otherId,
          kind: 'diagram',
          title: 'Destination',
          inputVersionIds: [reassigned.extracted.version.id]
        });

        for (const material of [reassigned.original])
          yield* projects.removeMaterial({ projectId: fixture.otherId, materialId: material.id });
      }).pipe(Effect.provide(services()))
    );
    context.close();
    context = new ServerContext(location.open());
    await project('reassigned', reassignedEvent);
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const listed = yield* materials.materials({
          projectId: fixture.otherId,
          archived: false,
          limit: 10
        });

        assert.equal(
          listed.items.length,
          0,
          'completed workflow replay preserves later membership removal'
        );
      }).pipe(Effect.provide(services()))
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* Sources;

        yield* sources.replaceSource({
          id: event.sourceId,
          expectedRevision: (yield* sources.sourceProcessing(event.sourceId)).revision,
          name: 'replacement.txt',
          bytes: new TextEncoder().encode('Replacement')
        });
      }).pipe(Effect.provide(services()))
    );
    const replacementEvent = await reindex('replace-bytes');
    const replacement = await project('project-replacement', replacementEvent);

    assert.equal(replacement.original.id, result.original.id);
    assert.notEqual(replacement.original.version.id, result.original.version.id);
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;

        assert.deepEqual(
          (yield* materials.materialVersionExport({ id: replacement.extracted.version.id })).bytes,
          new TextEncoder().encode('Replacement')
        );
        assert.deepEqual(
          (yield* materials.materialVersionExport({ id: result.extracted.version.id })).bytes,
          new TextEncoder().encode('Hello')
        );
      }).pipe(Effect.provide(services()))
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const materials = yield* Materials;
          const source = yield* sources.createSource({
            projectId: null,
            name: 'unsupported.bin',
            bytes: new Uint8Array([0, 255, 0, 255])
          });
          const state = yield* sources.sourceProcessing(source.id);

          assert.ok(state.requestId);
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
          yield* Effect.flip(
            engine.execute(sourceIngestionWorkflow, {
              executionId: 'unsupported',
              payload: {
                event: {
                  type: 'SourceProcessingRequested',
                  sourceId: source.id,
                  requestId: state.requestId,
                  inputVersion: state.revision,
                  eventId: 'unsupported-request',
                  causationId: null,
                  correlationId: state.requestId,
                  depth: 0
                }
              }
            })
          );
          const listed = yield* materials.materials({ archived: false, limit: 10 });
          const imported = listed.items.find(
            (item) => item.importProcessing?.sourceId === source.id
          );

          assert.ok(imported);
          const material = yield* materials.material({ id: imported.id });

          assert.equal(material.importProcessing?.status, 'failed');
          assert.ok('extracted' in material.version.content);
          assert.equal(material.version.content.extracted, null);
          assert.deepEqual(
            (yield* materials.materialVersionExport({ id: material.version.id })).bytes,
            new Uint8Array([0, 255, 0, 255])
          );
        }).pipe(Effect.provide(services()))
      )
    );
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
  }
});
