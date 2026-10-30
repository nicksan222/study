import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MaterialVersionId } from '@study/contracts/ids';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { withPublicationGuard } from '#server/platform/workflows/publication';

test('guarded generation publishes once and replays its receipt', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Projects.layer, Materials.layer).pipe(
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
        const project = yield* projects.createProject({ name: 'Generation' });
        const doc = yield* materials.create({
          projectId: project.id,
          title: 'Doc',
          content: {
            kind: 'document',
            blocks: [
              { kind: 'paragraph', text: 'Source evidence', anchor: { type: 'page', page: 1 } }
            ],
            meta: {
              extractor: null,
              extractorVersion: 1,
              provider: null,
              durationMs: null,
              pageCount: null,
              refiners: [],
              waitingFor: [],
              corrected: false
            }
          }
        });
        const scope = { scopeId: 'publication-epoch', projectId: project.id };

        yield* materials.openGenerationScope(scope);
        const late = yield* materials.requestMaterialGeneration({
          projectId: project.id,
          title: 'Late',
          kind: 'flashcards',
          inputVersionIds: [doc.version.id],
          scopeId: scope.scopeId
        });
        const request = yield* materials.requestMaterialGeneration({
          projectId: project.id,
          scopeId: scope.scopeId,
          title: 'Cards',
          kind: 'flashcards',
          inputVersionIds: [doc.version.id]
        });
        const value = {
          requestId: request.id,
          content: { kind: 'flashcards' as const, cards: [{ front: 'Q', back: 'A' }] },
          citations: [
            { marker: 1n, inputVersionId: doc.version.id, blockOrdinal: 0, quote: 'Source' }
          ]
        };

        assert.equal(
          (yield* Effect.flip(materials.publishMaterialGeneration({ ...value, citations: [] })))
            .kind,
          'invalid_input'
        );

        assert.equal(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              content: { kind: 'diagram', format: 'mermaid', payload: 'graph TD' }
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              citations: [{ ...value.citations[0]!, quote: 'forged' }]
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              citations: [{ ...value.citations[0]!, blockOrdinal: 100 }]
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              citations: [value.citations[0]!, value.citations[0]!]
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              citations: [{ ...value.citations[0]!, marker: 0n }]
            })
          )).kind,
          'invalid_input'
        );
        const other = yield* projects.createProject({ name: 'Other' });
        const foreign = yield* materials.create({
          projectId: other.id,
          title: 'Foreign',
          content: doc.version.content
        });

        assert.equal(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              citations: [{ ...value.citations[0]!, inputVersionId: foreign.version.id }]
            })
          )).kind,
          'invalid_input'
        );
        context.db.exec(
          "CREATE TRIGGER reject_generated_event BEFORE INSERT ON workflow_events WHEN NEW.type='MaterialPublished' BEGIN SELECT RAISE(ABORT, 'rejected'); END"
        );
        const count = context.db.orm.all(sql`SELECT * FROM materials`).length;

        yield* Effect.flip(materials.publishMaterialGeneration(value));
        assert.equal(context.db.orm.all(sql`SELECT * FROM materials`).length, count);
        assert.equal(
          (yield* materials.materialGeneration({ requestId: request.id })).resultVersionId,
          null
        );
        context.db.exec('DROP TRIGGER reject_generated_event');
        const quiz = yield* materials.requestMaterialGeneration({
          projectId: project.id,
          title: 'Quiz',
          kind: 'quiz',
          inputVersionIds: [doc.version.id],
          questionSpec: { count: 1, kind: 'open' }
        });
        const question = {
          kind: 'open' as const,
          prompt: 'Q',
          explanation: 'E',
          referenceAnswer: 'A'
        };

        assert.equal(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              requestId: quiz.id,
              citations: value.citations,
              content: { kind: 'quiz', questions: [question, question] }
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(
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
          )).kind,
          'invalid_input'
        );
        yield* materials.publishMaterialGeneration({
          requestId: quiz.id,
          citations: value.citations,
          content: { kind: 'quiz', questions: [question] }
        });
        const result = yield* materials.publishMaterialGeneration(value);

        yield* materials.closeGenerationScope(scope);
        assert.equal(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({ ...value, requestId: late.id })
          )).kind,
          'invalid_input'
        );
        assert.equal(yield* materials.publishMaterialGeneration(value), result);
        assert.equal(
          (yield* materials.materialGeneration({ requestId: request.id })).resultVersionId,
          result
        );

        assert.equal((yield* materials.materialVersion({ id: result })).creator, 'agent');
        const published = yield* materials.materialVersion({ id: result });

        assert.equal(published.operation, 'generate');
        assert.deepEqual(published.inputs, [doc.version.id]);
        assert.deepEqual((yield* materials.citations({ id: result, limit: 10 })).items, [
          {
            marker: 1n,
            inputVersionId: doc.version.id,
            anchor: { type: 'page', page: 1 },
            quote: 'Source'
          }
        ]);
        assert.throws(() =>
          context.db.orm.run(
            sql`UPDATE material_generation_requests SET result_hash='changed' WHERE id=${request.id}`
          )
        );
        assert.equal(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({
              ...value,
              content: { ...value.content, cards: [{ front: 'Changed', back: 'A' }] }
            })
          )).kind,
          'invalid_input'
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
            inputVersionIds: [doc.version.id],
            instruction: 'Focus'
          });
          const id = yield* materials.publishMaterialGeneration({
            requestId: next.id,
            content,
            citations: value.citations
          });
          const version = yield* materials.materialVersion({ id });

          assert.equal(version.kind, content.kind);
          assert.equal(version.instruction, 'Focus');
        }

        const stale = yield* materials.requestMaterialGeneration({
          projectId: project.id,
          title: 'Stale',
          kind: 'flashcards',
          inputVersionIds: [doc.version.id]
        });

        yield* materials.archive({ id: doc.id });
        assert.equal(
          (yield* Effect.flip(materials.materialGeneration({ requestId: stale.id }))).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(
            materials.publishMaterialGeneration({ ...value, requestId: stale.id })
          )).kind,
          'invalid_input'
        );
        assert.equal(yield* materials.publishMaterialGeneration(value), result);
        const events = context.db.orm.all<{
          type: string;
          causation_id: string;
          correlation_id: string;
          depth: number;
        }>(
          sql`SELECT type, causation_id, correlation_id, depth FROM workflow_events WHERE causation_id=${request.id}`
        );

        assert.equal(events.length, 1);
        assert.equal(events[0]!.correlation_id, request.id);
        assert.equal(events[0]!.depth, 1n);
        context.db.orm.run(sql`DELETE FROM projects WHERE id=${project.id}`);
        context.db.orm.run(sql`DELETE FROM projects WHERE id=${other.id}`);
        assert.equal(context.db.orm.all(sql`SELECT * FROM material_generation_requests`).length, 0);
        complete = true;
      }).pipe(Effect.provide(services))
    ).pipe(Effect.orDie)
  });

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
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

        assert.equal(error.kind, 'internal');
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
    assert.equal(complete, true);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('receipt persists across reopen and a new workflow execution', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  let requestId = '';
  let versionId = 0n as MaterialVersionId;
  let resultId = 0n as MaterialVersionId;
  const run = async (executionId: string, replay: boolean) => {
    const services = Layer.mergeAll(Projects.layer, Materials.layer).pipe(
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

          if (!replay) {
            const projects = yield* Projects;
            const project = yield* projects.createProject({ name: 'Reopen' });
            const doc = yield* materials.create({
              projectId: project.id,
              title: 'Doc',
              content: {
                kind: 'document',
                blocks: [
                  { kind: 'paragraph', text: 'Evidence', anchor: { type: 'page', page: 1 } }
                ],
                meta: {
                  extractor: null,
                  extractorVersion: 1,
                  provider: null,
                  durationMs: null,
                  pageCount: null,
                  refiners: [],
                  waitingFor: [],
                  corrected: false
                }
              }
            });

            versionId = doc.version.id;
            requestId = (yield* materials.requestMaterialGeneration({
              projectId: project.id,
              title: 'Cards',
              kind: 'flashcards',
              inputVersionIds: [versionId]
            })).id;
          }

          const value = {
            requestId,
            content: { kind: 'flashcards' as const, cards: [{ front: 'Q', back: 'A' }] },
            citations: [
              { marker: 1n, inputVersionId: versionId, blockOrdinal: 0, quote: 'Evidence' }
            ]
          };

          if (replay) {
            assert.equal(
              (yield* materials.materialGeneration({ requestId })).resultVersionId,
              resultId
            );
            assert.equal(yield* materials.publishMaterialGeneration(value), resultId);
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
    assert.equal(
      context.db.orm.all(sql`SELECT * FROM workflow_events WHERE causation_id=${requestId}`).length,
      1
    );
    assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
  } finally {
    context.close();
    location.cleanup();
  }
});
