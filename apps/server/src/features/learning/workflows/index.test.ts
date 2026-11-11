/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks grading checkpoints provider output and rejects stale or manual             │
 * │ submissions; practice slots reuse their generation request and ignore manual             │
 * │ publication.                                                                             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses provider stubs and persisted workflow state to check grading fences and replay.   │
 * │ - Asserts durable effects against persisted state and replay behavior.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite drives the native workflow engine with persisted test state; it does not       │
 * │ replace production activities.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema } from '@study/contracts/errors';
import { defaultAgentRules } from '@study/contracts/settings/types';
import { plainBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import type { Context } from 'effect';
import { Effect, Layer, Option, Schema } from 'effect';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Learning } from '#server/features/learning/service/index';
import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';
import { withPublicationGuard } from '#server/platform/workflows/publication';

import {
  quizGradingHandler,
  quizGradingWorkflow,
  practiceSlotWorkflow,
  practiceSlotHandler,
  practiceFailureWorkflow,
  practiceFailureHandler,
  practicePublicationWorkflow,
  practicePublicationHandler
} from './index.ts';

testStable(
  'grading checkpoints provider output and fences stale and manual submissions',
  async () => {
    let calls = 0;
    let duringCall: (() => Promise<void>) | undefined;
    const peer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        let events = '';

        await request.text();

        calls++;

        if (duringCall) {
          const action = duringCall;

          duringCall = undefined;
          await action();
        }

        for (const event of [
          { type: 'response.created', response: { id: 'resp', created_at: 1, model: 'test' } },
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'item' }
          },
          {
            type: 'response.output_text.delta',
            item_id: 'item',
            delta: JSON.stringify({ verdict: 'partly', feedback: 'Good' })
          },
          { type: 'response.completed', response: {} }
        ])
          events += `data: ${JSON.stringify(event)}\n\n`;

        return new Response(events + 'data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' }
        });
      }
    });

    assert.ok(peer.port, 'missing address');
    const base = peer.url.origin;
    const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'token', expiresIn: 3600 }
    );
    const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
    const location = await createTestDatabase();
    let context = new ServerContext(await location.open());
    const services = () =>
      Layer.mergeAll(
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        Layer.succeed(Database, { store: context }),
        Learning.layer
          .pipe(
            Layer.provideMerge(Settings.layer),
            Layer.provideMerge(Materials.layer),
            Layer.provideMerge(Pages.layer)
          )
          .pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
        agentsLayer({
          model: () => Effect.succeed(model),
          language: 'en',
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        workflowEngineLayer(context)
      );
    const run = <A, E>(
      effect: Effect.Effect<A, E, Database | Context.Service.Identifier<typeof Learning>>
    ) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide(
            Learning.layer
              .pipe(
                Layer.provideMerge(Settings.layer),
                Layer.provideMerge(Materials.layer),
                Layer.provideMerge(Pages.layer)
              )
              .pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })))
          )
        )
      );

    try {
      const db = context.db.orm;
      const project = db
        .insert(s.projects)
        .values({ name: 'P', created_at: 1n, updated_at: 1n })
        .returning()
        .get();
      const material = db
        .insert(s.materials)
        .values({ kind: 'quiz', title: 'Q', created_at: 1n, updated_at: 1n })
        .returning()
        .get();

      db.insert(s.project_materials)
        .values({ project_id: project.id, material_id: material.id })
        .run();
      const version = db
        .insert(s.material_versions)
        .values({
          material_id: material.id,
          kind: 'quiz',
          number: 1n,
          created_at: 1n
        })
        .returning()
        .get();

      db.insert(s.material_quiz_versions).values({ version_id: version.id }).run();
      const question = db
        .insert(s.material_quiz_questions)
        .values({
          version_id: version.id,
          position: 0n,
          kind: 'open',
          prompt: 'Question',
          explanation: 'Explanation'
        })
        .returning()
        .get();

      db.insert(s.material_quiz_open_answers)
        .values({ question_id: question.id, reference_answer: 'Reference' })
        .run();
      db.update(s.material_versions)
        .set({ status: 'published', published_at: 1n })
        .where(eq(s.material_versions.id, version.id))
        .run();
      const attempt = await run(
        Effect.flatMap(Learning, (learning) => learning.startQuiz({ versionId: version.id }))
      );
      const submit = async (answer: string) => {
        await run(
          Effect.flatMap(Learning, (learning) =>
            learning.answerQuestion({
              attemptId: attempt.id,
              questionId: question.id,
              answer: { type: 'open', answer }
            })
          )
        );
        const event = decodeEvent(
          context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
        );

        assert.ok(!(event.type !== 'QuizAnswerSubmitted'), 'wrong event');

        return event;
      };
      const execute = (event: Awaited<ReturnType<typeof submit>>, id: string) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              yield* engine.register(quizGradingWorkflow, quizGradingHandler);

              return yield* engine.execute(quizGradingWorkflow, {
                executionId: id,
                payload: { event }
              });
            }).pipe(Effect.provide(services()))
          )
        );
      const old = await submit('same');
      const current = await submit('same');

      await expect(execute(old, 'stale')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, 0);
      context.db.orm.run(
        sql`CREATE TRIGGER fail_grade BEFORE UPDATE OF score ON material_quiz_responses BEGIN SELECT RAISE(ABORT, 'publication unavailable'); END`
      );
      await expect(execute(current, 'replay')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, 1);
      context.db.orm.run(sql`DROP TRIGGER fail_grade`);
      context.db.orm.run(
        sql`DELETE FROM workflow_activities WHERE execution_id = 'replay' AND name = 'publish-grade'`
      );
      context.db.orm.run(
        sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = 'replay'`
      );
      context.close();
      context = new ServerContext(await location.open());
      await execute(current, 'replay');
      assert.strictEqual(calls, 1);
      assert.strictEqual(context.db.orm.select().from(s.material_quiz_responses).get()?.score, 0.5);
      const racing = await submit('racing');

      duringCall = async () => {
        await submit('newer');
      };
      await expect(execute(racing, 'race')).rejects.toSatisfy(() => true);
      assert.ok(context.db.orm.select().from(s.material_quiz_responses).get()?.score === null);
      const manualRace = await submit('manual race');

      duringCall = async () => {
        await run(
          Effect.flatMap(Learning, (learning) =>
            learning.gradeResponse({
              attemptId: attempt.id,
              questionId: question.id,
              score: 1,
              feedback: 'Manual race'
            })
          )
        );
      };
      await execute(manualRace, 'manual-race');
      assert.strictEqual(context.db.orm.select().from(s.material_quiz_responses).get()?.score, 1);
      assert.ok(
        context.db.orm.select().from(s.material_quiz_responses).get()?.feedback === 'Manual race'
      );
      const manual = await submit('manual');

      await run(
        Effect.flatMap(Learning, (learning) =>
          learning.gradeResponse({
            attemptId: attempt.id,
            questionId: question.id,
            score: 1,
            feedback: 'Manual'
          })
        )
      );
      await expect(execute(manual, 'manual')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, 3);
      assert.strictEqual(context.db.orm.select().from(s.material_quiz_responses).get()?.score, 1);
      const finished = await submit('finished');

      await run(
        Effect.flatMap(Learning, (learning) => learning.finishQuiz({ attemptId: attempt.id }))
      );
      const completed = await execute(finished, 'finished');

      assert.ok(completed.status === 'completed');
      assert.strictEqual(completed.scoring.score, 0.5);
      assert.strictEqual(calls, 4);
      expect(() =>
        context.db.orm
          .update(s.material_quiz_responses)
          .set({ score: 1 })
          .where(eq(s.material_quiz_responses.attempt_id, attempt.id))
          .run()
      ).toThrow();
      expect(() =>
        context.db.orm
          .update(s.material_quiz_responses)
          .set({ answer: 'changed' })
          .where(eq(s.material_quiz_responses.attempt_id, attempt.id))
          .run()
      ).toThrow();
      const beforeGrade = context.db.orm.select().from(s.material_quiz_responses).get()!;

      await execute(finished, 'finished');
      assert.deepStrictEqual(
        context.db.orm.select().from(s.material_quiz_responses).get(),
        beforeGrade
      );
      await expect(
        run(
          Effect.flatMap(Learning, (learning) =>
            learning.answerQuestion({
              attemptId: attempt.id,
              questionId: question.id,
              answer: { type: 'open', answer: 'edited after completion' }
            })
          )
        )
      ).rejects.toSatisfy(() => true);
      await expect(
        run(
          Effect.flatMap(Learning, (learning) =>
            learning.gradeResponse({
              attemptId: attempt.id,
              questionId: question.id,
              score: 1,
              feedback: 'manual edit'
            })
          )
        )
      ).rejects.toSatisfy(() => true);
    } finally {
      await auth.dispose();
      context.close();
      await location.cleanup();
      await peer.stop(true);
    }
  }
);

testStable(
  'practice slot workflow reuses its generation request and ignores manual publication',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const dbLayer = Layer.succeed(Database, { store: context });
    const services = Layer.mergeAll(
      Learning.layer.pipe(
        Layer.provideMerge(Settings.layer),
        Layer.provideMerge(Materials.layer),
        Layer.provideMerge(Pages.layer)
      ),
      workflowEngineLayer(context)
    ).pipe(Layer.provideMerge(dbLayer));

    try {
      const project = context.db.orm
        .insert(s.projects)
        .values({ name: 'Practice', created_at: 1n, updated_at: 1n })
        .returning()
        .get();

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const materials = yield* Materials;
            const learning = yield* Learning;
            const engine = yield* WorkflowEngine.WorkflowEngine;
            const doc = yield* (yield* Pages).create({
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              projectId: project.id,
              title: 'Document',
              document: {
                blocks: [plainBlock('paragraph', 'Practice source', { type: 'authored' })],
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

            yield* learning.startPractice({
              projectId: project.id,
              inputs: [{ kind: 'page', versionId: doc.version!.id }]
            });
            const event = decodeEvent(
              context.db.orm
                .select()
                .from(s.workflowEvents)
                .all()
                .find((row) => row.type === 'PracticeSlotRequested')!.payload
            );

            assert.ok(!(event.type !== 'PracticeSlotRequested'), 'wrong event');

            assert.ok(yield* learning.practiceSlot(event.slotId));
            yield* engine.register(practiceSlotWorkflow, practiceSlotHandler);
            yield* engine.register(practicePublicationWorkflow, practicePublicationHandler);
            yield* engine.execute(practiceSlotWorkflow, {
              executionId: 'practice-a',
              payload: { event }
            });
            const settings = yield* Settings;
            const appSettings = yield* settings.appSettings();

            yield* settings.saveAppSettings({ ...appSettings, language: 2 });
            yield* engine.execute(practiceSlotWorkflow, {
              executionId: 'practice-b',
              payload: { event }
            });
            assert.strictEqual(
              context.db.orm.select().from(s.material_generation_requests).all().length,
              1
            );
            assert.strictEqual(
              context.db.orm
                .select()
                .from(s.workflowEvents)
                .all()
                .filter((row) => row.type === 'MaterialGenerationRequested').length,
              1
            );
            const terminal = Workflow.make('practice-terminal-test', {
              payload: { id: Schema.String },
              success: Schema.Boolean,
              error: failureSchema,
              idempotencyKey: ({ id }) => id
            });

            yield* engine.register(terminal, () =>
              Effect.fail({ kind: 'config' as const, message: 'private', retryAfterMs: null })
            );
            yield* Effect.flip(
              engine.execute(terminal, {
                executionId: 'failed-generation',
                payload: { id: event.slotId }
              })
            );
            context.db.orm
              .insert(s.workflowReceipts)
              .values({
                eventId: event.slotId,
                subscription: 'material-generation',
                workflowVersion: 1,
                inputVersion: 1,
                executionId: 'failed-generation',
                createdAt: Date.now()
              })
              .run();
            const derived = (yield* learning.practice({ projectId: project.id })).slots[0]!;

            assert.ok(derived.status === 'failed');
            assert.ok(derived.failureKind === 'config');
            yield* engine.register(practiceFailureWorkflow, practiceFailureHandler);
            const failedEvent = {
              type: 'MaterialGenerationFailed' as const,
              eventId: 'practice-failure',
              correlationId: event.slotId,
              causationId: event.slotId,
              inputVersion: 1,
              depth: 0,
              requestId: event.slotId,
              projectId: project.id,
              kind: 'quiz' as const,
              generationEventId: event.slotId,
              errorKind: 'config' as const
            };

            assert.strictEqual(
              yield* engine.execute(practiceFailureWorkflow, {
                executionId: 'record-failure',
                payload: { event: failedEvent }
              }),
              true
            );
            const failed = (yield* learning.practice({ projectId: project.id })).slots[0]!;

            assert.ok(failed.status === 'failed');
            assert.ok(failed.failureKind === 'config');
            const retried = yield* learning.retryPracticeQuestion({ slotId: event.slotId });

            assert.strictEqual(retried.slotId, failed.slotId);
            assert.strictEqual(retried.ordinal, failed.ordinal);
            assert.strictEqual(retried.kind, failed.kind);
            expect(retried.inputs).toStrictEqual(failed.inputs);
            yield* learning.retryPracticeQuestion({ slotId: event.slotId });
            assert.strictEqual(
              yield* engine.execute(practiceFailureWorkflow, {
                executionId: 'stale-failure',
                payload: { event: failedEvent }
              }),
              false
            );
            const retryEvent = context.db.orm
              .select()
              .from(s.workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (value) =>
                  value.type === 'PracticeSlotRequested' &&
                  value.slotId === event.slotId &&
                  value.eventId !== event.eventId
              );

            assert.ok(
              !(!retryEvent || retryEvent.type !== 'PracticeSlotRequested'),
              'missing retry event'
            );

            yield* engine.execute(practiceSlotWorkflow, {
              executionId: 'practice-retry',
              payload: { event: retryEvent }
            });
            assert.strictEqual(
              context.db.orm
                .select()
                .from(s.workflowEvents)
                .all()
                .filter((row) => row.type === 'MaterialGenerationRequested').length,
              2
            );
            const secondEvent = context.db.orm
              .select()
              .from(s.workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (value) => value.type === 'PracticeSlotRequested' && value.slotId !== event.slotId
              );

            assert.ok(
              !(!secondEvent || secondEvent.type !== 'PracticeSlotRequested'),
              'missing second slot'
            );

            yield* engine.execute(practiceSlotWorkflow, {
              executionId: 'practice-second',
              payload: { event: secondEvent }
            });
            const cancelledWorkflow = Workflow.make('practice-cancel-test', {
              payload: { id: Schema.String },
              idempotencyKey: ({ id }) => id
            });
            const gate = DurableDeferred.make('practice-cancel-gate');

            yield* engine.register(cancelledWorkflow, () => DurableDeferred.await(gate));
            yield* engine.execute(cancelledWorkflow, {
              executionId: 'cancelled-generation',
              payload: { id: secondEvent.slotId },
              discard: true
            });

            while (Option.isNone(yield* engine.poll(cancelledWorkflow, 'cancelled-generation')))
              yield* Effect.sleep('10 millis');

            yield* engine.interrupt(cancelledWorkflow, 'cancelled-generation');
            yield* Effect.sleep('50 millis');
            context.db.orm
              .insert(s.workflowReceipts)
              .values({
                eventId: secondEvent.slotId,
                subscription: 'material-generation',
                workflowVersion: 1,
                inputVersion: 1,
                executionId: 'cancelled-generation',
                createdAt: Date.now()
              })
              .run();
            const cancelledSlot = (yield* learning.practice({ projectId: project.id })).slots.find(
              (slot) => slot.slotId === secondEvent.slotId
            )!;

            assert.ok(cancelledSlot.status === 'failed');
            assert.ok(cancelledSlot.failureKind === 'cancelled');
            assert.ok(
              (yield* learning.retryPracticeQuestion({ slotId: secondEvent.slotId })).status ===
                'pending'
            );
            const publisher = Workflow.make('practice-test-publisher', {
              payload: { id: Schema.String },
              success: Schema.BigInt,
              error: failureSchema,
              idempotencyKey: ({ id }) => id
            });

            yield* engine.register(publisher, ({ id }) =>
              Activity.make({
                name: 'publish',
                success: Schema.BigInt,
                error: failureSchema,
                execute: withPublicationGuard(
                  context,
                  materials.publishMaterialGeneration({
                    requestId: id,
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
                    },
                    citations: [
                      {
                        marker: 1n,
                        input: { kind: 'page', versionId: doc.version!.id },
                        blockOrdinal: 0,
                        quote: 'Practice source'
                      }
                    ]
                  })
                )
              })
            );
            const versionId = yield* engine.execute(publisher, {
              executionId: 'practice-generate',
              payload: { id: event.slotId }
            });
            const publication = decodeEvent(
              context.db.orm
                .select()
                .from(s.workflowEvents)
                .all()
                .find(
                  (row) => row.type === 'MaterialPublished' && row.causationId === event.slotId
                )!.payload
            );

            assert.ok(!(publication.type !== 'MaterialPublished'), 'wrong publication');

            assert.strictEqual(
              yield* engine.execute(practicePublicationWorkflow, {
                executionId: 'attach-practice',
                payload: { event: publication }
              }),
              true
            );
            assert.strictEqual(
              yield* engine.execute(practicePublicationWorkflow, {
                executionId: 'attach-practice-again',
                payload: { event: publication }
              }),
              true
            );
            const snapshot = yield* learning.practice({ projectId: project.id });
            const ready = snapshot.slots.find((slot) => slot.slotId === event.slotId)!;

            assert.strictEqual(ready.versionId, versionId);
            const attempt = yield* learning.attempt(ready.attemptId!);

            assert.strictEqual(attempt.practiceSlotId, ready.slotId);
            const question = attempt.questions[0]!;

            assert.ok('choices' in question, 'wrong question kind');

            assert.ok(
              (yield* Effect.flip(
                learning.answerQuestion({
                  attemptId: ready.attemptId!,
                  questionId: question.id,
                  answer: { type: 'choice', choiceIds: [question.choices[0]!.id] }
                })
              )).kind === 'invalid_input'
            );

            yield* learning.answerPracticeQuestion({
              slotId: ready.slotId,
              answer: { type: 'choice', choiceIds: [question.choices[0]!.id] }
            });
            yield* learning.answerPracticeQuestion({
              slotId: ready.slotId,
              answer: { type: 'choice', choiceIds: [question.choices[0]!.id] }
            });
            assert.ok(
              (yield* Effect.flip(
                learning.answerPracticeQuestion({
                  slotId: ready.slotId,
                  answer: { type: 'choice', choiceIds: [question.choices[1]!.id] }
                })
              )).kind === 'invalid_input'
            );
            assert.throws(() =>
              context.db.orm
                .delete(s.material_quiz_selections)
                .where(eq(s.material_quiz_selections.attempt_id, ready.attemptId!))
                .run()
            );
            const refilled = yield* learning.practice({ projectId: project.id });

            expect(refilled.slots.map((slot) => slot.kind)).toStrictEqual(['choice', 'open']);
            assert.strictEqual(
              context.db.orm.select().from(s.material_quiz_attempts).all().length,
              1
            );
            assert.strictEqual(
              context.db.orm
                .select()
                .from(s.workflowEvents)
                .all()
                .filter((row) => row.type === 'PracticeSlotRequested').length,
              5
            );
            yield* learning.finishQuiz({ attemptId: ready.attemptId! });
            yield* learning.stopPractice({ projectId: project.id });
            yield* learning.startPractice({
              projectId: project.id,
              inputs: [{ kind: 'page', versionId: doc.version!.id }]
            });
            const replay = yield* learning.answerPracticeQuestion({
              slotId: ready.slotId,
              answer: { type: 'choice', choiceIds: [question.choices[0]!.id] }
            });

            assert.ok(replay.status === 'completed');
            assert.strictEqual(replay.id, ready.attemptId);
            assert.ok(
              (yield* Effect.flip(
                learning.answerPracticeQuestion({
                  slotId: ready.slotId,
                  answer: { type: 'choice', choiceIds: [question.choices[1]!.id] }
                })
              )).kind === 'invalid_input'
            );
            const manualOutput = yield* materials.create({
              projectId: project.id,
              title: 'Manual diagram',
              content: { kind: 'diagram', format: 'mermaid', payload: 'flowchart TD\nA-->B' }
            });
            const manual = {
              type: 'MaterialPublished' as const,
              eventId: 'manual',
              correlationId: 'manual',
              causationId: null,
              inputVersion: 1,
              depth: 0,
              projectId: project.id,
              materialId: manualOutput.id,
              materialVersionId: manualOutput.version.id
            };

            assert.strictEqual(
              yield* engine.execute(practicePublicationWorkflow, {
                executionId: 'manual-practice',
                payload: { event: manual }
              }),
              false
            );
          }).pipe(Effect.provide(services))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
