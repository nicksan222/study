/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies guarded material generation publishes once, replays its receipt without   │
 * │ duplicate writes, and retains that receipt across database reopen and a new execution.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reopens SQLite and retries executions to assert publication receipts remain durable.   │
 * │ - Asserts durable effects against persisted state and replay behavior.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite drives the native workflow engine with persisted test state; it does not       │
 * │ replace production activities.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialVersionId, StudyDocumentVersionId } from '@study/contracts/ids';
import { plainBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { withPublicationGuard } from '#server/platform/workflows/publication';

testStable('guarded generation publishes once and replays its receipt', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Projects.layer, Materials.layer, Documents.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );
  let complete = false;
  const workflow = Workflow.make('generation-publication-test', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id
  });
  const activity = Activity.make({
    name: 'publish',
    execute: withPublicationGuard(
      context,
      Effect.gen(function* () {
        const projects = yield* Projects;
        const materials = yield* Materials;

        const documents = yield* Documents;
        const project = yield* projects.createProject({ name: 'Generation' });
        const doc = yield* documents.create({
          createKey: crypto.randomUUID(),
          inputs: [],
          citations: [],
          projectId: project.id,
          title: 'Doc',
          document: {
            blocks: [plainBlock('paragraph', 'Source evidence', { type: 'authored' })],
            meta: {
              extractor: null,
              extractorVersion: 1,
              provider: null,
              durationMs: null,
              pageCount: null,
              refiners: [],
              waitingFor: [],
              corrected: false,
              omissions: []
            }
          }
        });
        const scope = { scopeId: 'publication-epoch', projectId: project.id };

        yield* materials.openGenerationScope(scope);
        const late = yield* materials.requestMaterialGeneration({
          projectId: project.id,
          title: 'Late',
          kind: 'flashcards',
          inputs: [{ kind: 'document', versionId: doc.version!.id }],
          scopeId: scope.scopeId
        });
        const request = yield* materials.requestMaterialGeneration({
          projectId: project.id,
          scopeId: scope.scopeId,
          title: 'Cards',
          kind: 'flashcards',
          inputs: [{ kind: 'document', versionId: doc.version!.id }]
        });
        const value = {
          requestId: request.id,
          content: { kind: 'flashcards' as const, cards: [{ front: 'Q', back: 'A' }] },
          citations: [
            {
              marker: 1n,
              input: { kind: 'document' as const, versionId: doc.version!.id },
              blockOrdinal: 0,
              quote: 'Source'
            }
          ]
        };

        assert.ok(
          (yield* Effect.flip(materials.publishMaterialGeneration({ ...value, citations: [] })))
            .kind === 'invalid_input'
        );

        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              content: { kind: 'diagram', format: 'mermaid', payload: 'graph TD' }
            })
          )).kind === 'invalid_input'
        );
        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              citations: [{ ...value.citations[0]!, quote: 'forged' }]
            })
          )).kind === 'invalid_input'
        );
        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              citations: [{ ...value.citations[0]!, blockOrdinal: 100 }]
            })
          )).kind === 'invalid_input'
        );
        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              citations: [value.citations[0]!, value.citations[0]!]
            })
          )).kind === 'invalid_input'
        );
        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              citations: [{ ...value.citations[0]!, marker: 0n }]
            })
          )).kind === 'invalid_input'
        );
        const other = yield* projects.createProject({ name: 'Other' });
        const foreign = yield* documents.create({
          createKey: crypto.randomUUID(),
          inputs: [],
          citations: [],
          projectId: other.id,
          title: 'Foreign',
          document: {
            ...doc.version!.document,
            blocks: [plainBlock('paragraph', 'Foreign evidence', { type: 'authored' })]
          }
        });

        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              citations: [
                {
                  ...value.citations[0]!,
                  input: { kind: 'document' as const, versionId: foreign.version!.id }
                }
              ]
            })
          )).kind === 'invalid_input'
        );
        context.db.exec(
          "CREATE TRIGGER reject_generated_event BEFORE INSERT ON workflow_events WHEN NEW.type='MaterialPublished' BEGIN SELECT RAISE(ABORT, 'rejected'); END"
        );
        const count = context.db.orm.all(sql`SELECT * FROM materials`).length;

        yield* Effect.flip(materials.publishMaterialGeneration(value));
        assert.strictEqual(context.db.orm.all(sql`SELECT * FROM materials`).length, count);
        assert.ok(
          (yield* materials.materialGeneration({ requestId: request.id })).resultVersionId === null
        );
        context.db.exec('DROP TRIGGER reject_generated_event');
        const quiz = yield* materials.requestMaterialGeneration({
          projectId: project.id,
          title: 'Quiz',
          kind: 'quiz',
          inputs: [{ kind: 'document', versionId: doc.version!.id }],
          questionSpec: { count: 1, kind: 'open' }
        });
        const question = {
          kind: 'open' as const,
          prompt: 'Q',
          explanation: 'E',
          referenceAnswer: 'A'
        };

        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              requestId: quiz.id,
              citations: value.citations,
              content: { kind: 'quiz', questions: [question, question] }
            })
          )).kind === 'invalid_input'
        );
        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              requestId: quiz.id,
              citations: value.citations,
              content: {
                kind: 'quiz',
                questions: [
                  {
                    kind: 'single_choice',
                    prompt: 'Q',
                    explanation: 'E',
                    choices: [
                      { text: 'A', isCorrect: true },
                      { text: 'B', isCorrect: false }
                    ]
                  }
                ]
              }
            })
          )).kind === 'invalid_input'
        );
        yield* materials.publishMaterialGeneration({
          requestId: quiz.id,
          citations: value.citations,
          content: { kind: 'quiz', questions: [question] }
        });
        const result = yield* materials.publishMaterialGeneration(value);

        yield* materials.closeGenerationScope(scope);
        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({ ...value, requestId: late.id })
          )).kind === 'invalid_input'
        );
        assert.strictEqual(yield* materials.publishMaterialGeneration(value), result);
        assert.strictEqual(
          (yield* materials.materialGeneration({ requestId: request.id })).resultVersionId,
          result
        );

        assert.ok((yield* materials.materialVersion({ id: result })).creator === 'agent');
        const published = yield* materials.materialVersion({ id: result });

        assert.ok(published.operation === 'generate');
        expect(published.inputs).toStrictEqual([{ kind: 'document', versionId: doc.version!.id }]);
        expect((yield* materials.citations({ id: result, limit: 10 })).items).toStrictEqual([
          {
            marker: 1n,
            input: { kind: 'document', versionId: doc.version!.id },
            anchor: { type: 'authored' },
            quote: 'Source',
            target: undefined
          }
        ]);
        const blocked = yield* documents.previewDeletion({ id: doc.id });

        expect(blocked.blockedVersionIds).toStrictEqual([doc.version!.id]);
        assert.throws(() =>
          context.db.orm.run(
            sql`UPDATE material_generation_requests SET result_hash='changed' WHERE id=${request.id}`
          )
        );
        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              content: { ...value.content, cards: [{ front: 'Changed', back: 'A' }] }
            })
          )).kind === 'invalid_input'
        );

        for (const content of [
          { kind: 'diagram' as const, format: 'mermaid' as const, payload: 'graph TD; A-->B' },
          {
            kind: 'quiz' as const,
            questions: [
              { kind: 'open' as const, prompt: 'Q', explanation: 'E', referenceAnswer: 'A' }
            ]
          }
        ]) {
          const next = yield* materials.requestMaterialGeneration({
            projectId: project.id,
            title: 'Generated',
            kind: content.kind,
            inputs: [{ kind: 'document', versionId: doc.version!.id }],
            instruction: 'Focus'
          });
          const id = yield* materials.publishMaterialGeneration({
            requestId: next.id,
            content,
            citations: value.citations
          });
          const version = yield* materials.materialVersion({ id });

          assert.strictEqual(version.kind, content.kind);
          assert.ok(version.instruction === 'Focus');
        }

        const stale = yield* materials.requestMaterialGeneration({
          projectId: project.id,
          title: 'Stale',
          kind: 'flashcards',
          inputs: [{ kind: 'document', versionId: doc.version!.id }]
        });

        yield* documents.archive({ id: doc.id, archived: true });
        assert.ok(
          (yield* Effect.flip(materials.materialGeneration({ requestId: stale.id }))).kind ===
            'invalid_input'
        );
        assert.ok(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({ ...value, requestId: stale.id })
          )).kind === 'invalid_input'
        );
        assert.strictEqual(yield* materials.publishMaterialGeneration(value), result);
        const events = context.db.orm.all<{
          type: string;
          causation_id: string;
          correlation_id: string;
          depth: number;
        }>(
          sql`SELECT type, causation_id, correlation_id, depth FROM workflow_events WHERE causation_id=${request.id}`
        );

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0]!.correlation_id, request.id);
        expect(events[0]!.depth).toBe(1n);
        context.db.orm.run(sql`DELETE FROM projects WHERE id=${project.id}`);
        context.db.orm.run(sql`DELETE FROM projects WHERE id=${other.id}`);
        assert.strictEqual(
          context.db.orm.all(sql`SELECT * FROM material_generation_requests`).length,
          6
        );
        complete = true;
      }).pipe(Effect.provide(services))
    ).pipe(Effect.orDie)
  });

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;

        yield* Documents;
        const error = yield* Effect.flip(
          withPublicationGuard(
            context,
            materials.publishMaterialGeneration({
              requestId: 'missing',
              content: { kind: 'flashcards', cards: [{ front: 'Q', back: 'A' }] },
              citations: []
            })
          )
        );

        assert.ok(error.kind === 'internal');
      }).pipe(Effect.provide(services))
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);
          yield* engine.execute(workflow, {
            executionId: 'generation-publication',
            payload: { id: 'generation-publication' }
          });
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
    assert.isTrue(complete);
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable('receipt persists across reopen and a new workflow execution', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  let requestId = '';
  let versionId: StudyDocumentVersionId;
  let resultId = 0n as MaterialVersionId;
  const run = async (executionId: string, replay: boolean) => {
    const services = Layer.mergeAll(Projects.layer, Materials.layer, Documents.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    const workflow = Workflow.make('generation-reopen-test', {
      payload: { id: Schema.String },
      idempotencyKey: ({ id }) => id
    });
    const activity = Activity.make({
      name: 'publish',
      execute: withPublicationGuard(
        context,
        Effect.gen(function* () {
          const materials = yield* Materials;

          const documents = yield* Documents;

          if (!replay) {
            const projects = yield* Projects;
            const project = yield* projects.createProject({ name: 'Reopen' });
            const doc = yield* documents.create({
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              projectId: project.id,
              title: 'Doc',
              document: {
                blocks: [plainBlock('paragraph', 'Evidence', { type: 'authored' })],
                meta: {
                  extractor: null,
                  extractorVersion: 1,
                  provider: null,
                  durationMs: null,
                  pageCount: null,
                  refiners: [],
                  waitingFor: [],
                  corrected: false,
                  omissions: []
                }
              }
            });

            versionId = doc.version!.id;
            requestId = (yield* materials.requestMaterialGeneration({
              projectId: project.id,
              title: 'Cards',
              kind: 'flashcards',
              inputs: [{ kind: 'document', versionId }]
            })).id;
          }

          const value = {
            requestId,
            content: { kind: 'flashcards' as const, cards: [{ front: 'Q', back: 'A' }] },
            citations: [
              {
                marker: 1n,
                input: { kind: 'document' as const, versionId },
                blockOrdinal: 0,
                quote: 'Evidence'
              }
            ]
          };

          if (replay) {
            assert.strictEqual(
              (yield* materials.materialGeneration({ requestId })).resultVersionId,
              resultId
            );
            assert.strictEqual(yield* materials.publishMaterialGeneration(value), resultId);
          } else resultId = yield* materials.publishMaterialGeneration(value);
        }).pipe(Effect.provide(services))
      ).pipe(Effect.orDie)
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);
          yield* engine.execute(workflow, { executionId, payload: { id: executionId } });
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
  };

  try {
    await run('first-generation', false);
    context.close();
    context = new ServerContext(location.open());
    await run('second-generation', true);
    assert.strictEqual(
      context.db.orm.all(sql`SELECT * FROM workflow_events WHERE causation_id=${requestId}`).length,
      1
    );
    expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
  } finally {
    context.close();
    location.cleanup();
  }
});
