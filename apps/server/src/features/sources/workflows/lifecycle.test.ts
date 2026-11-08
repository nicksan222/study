/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises source lifecycle behavior through real persistence boundaries.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies native source ingestion, correction and reprocessing retain independent exact │
 * │   history across reopen without projections.                                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sql } from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Learning } from '#server/features/learning/index';
import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { decodeEvent } from '#server/platform/workflows/events';
import { pageTransformFixture } from '#testing/page-transform';

import {
  sourceIngestionWorkflow,
  sourceIngestionHandler,
  sourceCorrectionWorkflow,
  sourceCorrectionHandler
} from './index.ts';

testStable(
  'native source ingestion, correction and reprocessing retain independent exact history across reopen without projections',
  async () => {
    const f = await pageTransformFixture();
    const domain = () => Learning.layer.pipe(Layer.provideMerge(f.domain()));
    const event = (requestId: string) => {
      const row = f.context.db.orm.get(
        sql`SELECT payload FROM workflow_events WHERE correlation_id=${requestId} AND type IN ('SourceProcessingRequested','SourceCorrectionRequested') ORDER BY rowid DESC LIMIT 1`
      );

      assert.ok(row);
      const decoded = decodeEvent(String(row.payload));

      assert.ok(
        decoded.type === 'SourceProcessingRequested' || decoded.type === 'SourceCorrectionRequested'
      );

      return decoded;
    };
    const execute = (request: ReturnType<typeof event>, executionId: string) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
            yield* engine.register(sourceCorrectionWorkflow, sourceCorrectionHandler);

            return request.type === 'SourceProcessingRequested'
              ? yield* engine.execute(sourceIngestionWorkflow, {
                  executionId,
                  payload: { event: request }
                })
              : yield* engine.execute(sourceCorrectionWorkflow, {
                  executionId,
                  payload: { event: request }
                });
          }).pipe(Effect.provide(f.services()))
        )
      );

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const sources = yield* Sources;
          const project = yield* projects.createProject({ name: 'Original' });
          const other = yield* projects.createProject({ name: 'Destination' });
          const source = yield* sources.createSource({
            projectId: project.id,
            name: 'notes.txt',
            bytes: new TextEncoder().encode('Hello')
          });
          const state = yield* sources.sourceProcessing(source.id);

          assert.ok(state.requestId);

          return { source, project, other, request: event(state.requestId) };
        }).pipe(Effect.provide(domain()))
      );

      f.context.db.exec(
        "CREATE TRIGGER reject_indexed BEFORE INSERT ON workflow_events WHEN NEW.type='SourceIndexed' BEGIN SELECT RAISE(ABORT,'injected publication failure'); END"
      );
      await expect(execute(setup.request, 'rollback-ingestion')).rejects.toSatisfy(() => true);
      assert.strictEqual(
        f.context.db.orm.get(sql`SELECT count(*) n FROM source_extraction_revisions`)?.n,
        0n
      );
      assert.strictEqual(
        f.context.db.orm.get(sql`SELECT count(*) n FROM content_snapshots`)?.n,
        0n
      );
      f.context.db.exec('DROP TRIGGER reject_indexed');
      const first = await execute(setup.request, 'first-ingestion');

      assert.strictEqual(await execute(setup.request, 'first-ingestion'), first);
      assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
      assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM pages`)?.n, 0n);
      assert.throws(() =>
        f.context.db.orm.run(sql`UPDATE blocks SET text='tampered' WHERE document_id=${first}`)
      );
      f.reopen();
      assert.strictEqual(await execute(setup.request, 'first-ingestion'), first);
      const correction = await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const materials = yield* Materials;
          const learning = yield* Learning;
          const input = {
            kind: 'source' as const,
            sourceId: setup.source.id,
            revision: 1n,
            snapshotId: first
          };
          const request = yield* materials.requestMaterialGeneration({
            projectId: setup.project.id,
            title: 'Pinned generation',
            kind: 'flashcards',
            inputs: [input]
          });

          yield* learning.startPractice({ projectId: setup.project.id, inputs: [input] });
          yield* learning.stopPractice({ projectId: setup.project.id });
          const body = yield* sources.extraction(input);
          const state = yield* sources.correctBlock({
            id: setup.source.id,
            documentId: first,
            ordinal: 0,
            before: body.document.blocks[0]!.text,
            after: 'Corrected'
          });

          assert.ok(state.requestId);
          assert.strictEqual(yield* sources.currentExtraction({ id: setup.source.id }), null);
          assert.ok((yield* sources.extraction(input)).document.blocks[0]?.text === 'Hello');
          const capture = yield* materials.materialGeneration({ requestId: request.id });

          expect(capture.inputs).toStrictEqual([input]);

          return event(state.requestId);
        }).pipe(Effect.provide(domain()))
      );

      await expect(execute(setup.request, 'stale-ingestion')).rejects.toSatisfy(() => true);
      const corrected = await execute(correction, 'correction');

      assert.notStrictEqual(corrected, first);
      const fresh = await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;

          yield* sources.setSourceProject({ id: setup.source.id, projectId: null });
          const state = yield* sources.requestSourceProcessing({
            id: setup.source.id,
            expectedRevision: 1
          });

          assert.ok(state.requestId);

          return event(state.requestId);
        }).pipe(Effect.provide(domain()))
      );
      const reprocessed = await execute(fresh, 'reprocessed');

      assert.notStrictEqual(reprocessed, corrected);
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;

          assert.ok((yield* sources.source(setup.source.id)).projectId === null);
          yield* sources.setSourceProject({ id: setup.source.id, projectId: setup.other.id });
          assert.strictEqual((yield* sources.source(setup.source.id)).projectId, setup.other.id);
        }).pipe(Effect.provide(domain()))
      );
      f.reopen();
      await execute(fresh, 'reprocessed');
      const replacement = await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;

          assert.strictEqual((yield* sources.source(setup.source.id)).projectId, setup.other.id);
          const state = yield* sources.replaceSource({
            id: setup.source.id,
            expectedRevision: 1,
            name: 'replacement.txt',
            bytes: new TextEncoder().encode('Replacement')
          });

          assert.ok(state.requestId);

          return event(state.requestId);
        }).pipe(Effect.provide(domain()))
      );
      const replaced = await execute(replacement, 'replacement');

      assert.notStrictEqual(replaced, reprocessed);
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const projects = yield* Projects;
          const history = yield* sources.extractions({ sourceId: setup.source.id, limit: 10 });

          assert.strictEqual(history.items.length, 4);
          expect(new Set(history.items.map((item) => item.snapshotId))).toStrictEqual(
            new Set([first, corrected, reprocessed, replaced])
          );
          assert.ok(
            (yield* sources.extraction({
              sourceId: setup.source.id,
              revision: 1n,
              snapshotId: corrected
            })).document.blocks[0]?.text === 'Corrected'
          );
          assert.ok(
            new TextDecoder().decode(
              (yield* sources.exportRevision({ sourceId: setup.source.id, revision: 1n })).bytes
            ) === 'Hello'
          );
          assert.ok(
            new TextDecoder().decode(
              (yield* sources.exportRevision({ sourceId: setup.source.id, revision: 2n })).bytes
            ) === 'Replacement'
          );
          yield* projects.deleteProject({ id: setup.other.id });
          assert.ok((yield* sources.source(setup.source.id)).projectId === null);
          assert.strictEqual(
            (yield* sources.currentExtraction({ id: setup.source.id }))?.snapshotId,
            replaced
          );
          assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
          assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM pages`)?.n, 0n);
          expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
        }).pipe(Effect.provide(domain()))
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'unsupported native extraction keeps the original bytes and creates no fake source material',
  async () => {
    const f = await pageTransformFixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const bytes = new Uint8Array([0, 255, 0, 255]);
            const source = yield* sources.createSource({
              name: 'unsupported.bin',
              bytes,
              projectId: null
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
                    inputVersion: 1,
                    eventId: 'unsupported',
                    correlationId: state.requestId,
                    causationId: null,
                    depth: 0
                  }
                }
              })
            );
            assert.strictEqual(yield* sources.currentExtraction({ id: source.id }), null);
            expect(
              (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
            ).toStrictEqual(bytes);
            assert.ok(
              f.context.db.orm.get(
                sql`SELECT 1 FROM workflow_events WHERE type='SourceProcessingFailed'`
              )
            );
            assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
            assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM pages`)?.n, 0n);
          })
        ).pipe(Effect.provide(f.services()))
      );
    } finally {
      await f.close();
    }
  }
);
