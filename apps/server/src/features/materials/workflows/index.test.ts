import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sql } from '@study/db';
import { workflowEvents } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Materials } from '#server/features/materials/service/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import {
  sourceIngestionWorkflow,
  sourceIngestionHandler
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
      Layer.mergeAll(Projects.layer, Sources.layer, Materials.layer).pipe(
        Layer.provide(Layer.succeed(Database, { store: context }))
      ),
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
          const project = yield* projects.createProject({ name: 'Projection' });
          const other = yield* projects.createProject({ name: 'Other' });
          const source = yield* sources.createSource({
            projectId: project.id,
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
    assert.equal(context.db.orm.all(sql`SELECT * FROM materials`).length, 0);
    assert.equal(
      context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .filter((e) => e.type === 'MaterialPublished').length,
      0
    );
    context.db.orm.run(sql`DROP TRIGGER reject_material_event`);
    const result = await project('projection');

    assert.equal(result.original.version.kind, 'file');
    assert.equal(result.original.version.operation, 'original');
    assert.equal(result.extracted.version.kind, 'document');
    assert.equal(result.extracted.version.operation, 'extract');
    assert.deepEqual(result.extracted.version.inputs, [result.original.version.id]);

    if (result.extracted.version.content.kind === 'document')
      assert.equal(result.extracted.version.content.blocks[0]?.text, 'Hello');

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
    assert.equal(context.db.orm.all(sql`SELECT * FROM material_document_versions`).length, 2);
    assert.equal(
      context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .filter((e) => e.type === 'MaterialPublished').length,
      3
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;

        yield* materials.archive({ id: result.original.id });
      }).pipe(Effect.provide(services()))
    );
    const afterArchiveEvent = await reindex('reindex-after-archive');
    const afterArchive = await project('projection-after-archive', afterArchiveEvent);

    assert.notEqual(afterArchive.original.id, result.original.id);
    assert.deepEqual(afterArchive.extracted.version.inputs, [afterArchive.original.version.id]);
    assert.equal(afterArchive.original.archived_at, null);
    const archived = await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;

        return yield* materials.material({ id: result.original.id });
      }).pipe(Effect.provide(services()))
    );

    assert.notEqual(archived.archived_at, null);
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
  }
});
