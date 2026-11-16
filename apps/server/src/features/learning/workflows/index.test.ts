import { failureSchema } from '@study/contracts';
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
import { defaultAgentRules } from '@study/contracts';
import { plainBlock } from '@study/contracts';
import { executionIdSchema } from '@study/contracts';
import { eq, sql } from '@study/db';
import * as s from '@study/db';
import {
  agentsLayer,
  ServerContext,
  Database,
  normalizeError,
  reconcileCancellation,
  WorkflowConfiguration,
  cancelExecution,
  workflowEngineLayer,
  decodeEvent,
  withPublicationGuard
} from '@study/server';
import { test } from '@study/testing';
import type { Context } from 'effect';
import { Effect, Layer, Option, Schema } from 'effect';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import { learningGradeAgent } from '#server/features/learning/agents/learning-grade';
import { Learning } from '#server/features/learning/service/index';
import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { withTestAdmission } from '#testing/workflow-admission';

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

test.server.stable(
  'grading checkpoints provider output and fences stale and manual submissions',
  async ({ databases, createAiMock, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    using mock = createAiMock();
    const grade = (answer: string, hold = false) =>
      mock.next(learningGradeAgent, {
        input: { prompt: JSON.stringify({ question: 'Question', reference: 'Reference', answer }) },
        output: { verdict: 'partly', feedback: 'Good' },
        hold
      });
    const location = await databases();
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
          model: (tier, call) =>
            mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError)),
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
      const submit = async (
        { assert: assertions }: Pick<test.server.Context, 'assert'>,
        answer: string
      ) => {
        const assert: test.Assert = assertions;

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

              return yield* withTestAdmission(
                context,
                quizGradingWorkflow,
                id,
                { event },
                engine.execute(quizGradingWorkflow, {
                  executionId: id,
                  payload: { event }
                })
              );
            }).pipe(Effect.provide(services()))
          )
        );
      const old = await submit({ assert }, 'same');
      const current = await submit({ assert }, 'same');

      await expect(execute(old, 'stale')).rejects.toSatisfy(() => true);
      mock.verify();
      context.db.orm.run(
        sql`CREATE TRIGGER fail_grade BEFORE UPDATE OF score ON material_quiz_responses BEGIN SELECT RAISE(ABORT, 'publication unavailable'); END`
      );
      grade('same');
      await expect(execute(current, 'failed-publication')).rejects.toSatisfy(() => true);
      mock.verify();
      context.db.orm.run(sql`DROP TRIGGER fail_grade`);
      grade('same');
      await execute(current, 'replay');
      mock.verify();
      context.close();
      context = new ServerContext(await location.open());
      await execute(current, 'replay');
      mock.verify();
      assert.strictEqual(context.db.orm.select().from(s.material_quiz_responses).get()?.score, 0.5);
      const racing = await submit({ assert }, 'racing');

      const racingGrade = grade('racing', true);

      await Promise.all([
        expect(execute(racing, 'race')).rejects.toSatisfy(() => true),
        (async () => {
          await racingGrade.called;
          await submit({ assert }, 'newer');
          racingGrade.release();
        })()
      ]);
      assert.ok(context.db.orm.select().from(s.material_quiz_responses).get()?.score === null);
      const manualRace = await submit({ assert }, 'manual race');

      const manualGrade = grade('manual race', true);
      const manualExecution = execute(manualRace, 'manual-race');

      await manualGrade.called;
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
      manualGrade.release();
      await manualExecution;
      assert.strictEqual(context.db.orm.select().from(s.material_quiz_responses).get()?.score, 1);
      assert.ok(
        context.db.orm.select().from(s.material_quiz_responses).get()?.feedback === 'Manual race'
      );
      const manual = await submit({ assert }, 'manual');

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
      mock.verify();
      assert.strictEqual(context.db.orm.select().from(s.material_quiz_responses).get()?.score, 1);
      const finished = await submit({ assert }, 'finished');

      await run(
        Effect.flatMap(Learning, (learning) => learning.finishQuiz({ attemptId: attempt.id }))
      );
      grade('finished');
      const completed = await execute(finished, 'finished');

      assert.ok(completed.status === 'completed');
      assert.strictEqual(completed.scoring.score, 0.5);
      mock.verify();
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
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'practice slot workflow reuses its generation request and ignores manual publication',
  async ({ databases, assert: assertions, expect, pollUntil }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
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
            yield* withTestAdmission(
              context,
              practiceSlotWorkflow,
              'practice-a',
              { event },
              engine.execute(practiceSlotWorkflow, {
                executionId: 'practice-a',
                payload: { event }
              })
            );
            const settings = yield* Settings;
            const appSettings = yield* settings.appSettings();

            yield* settings.saveAppSettings({ ...appSettings, language: 2 });
            yield* withTestAdmission(
              context,
              practiceSlotWorkflow,
              'practice-b',
              { event },
              engine.execute(practiceSlotWorkflow, {
                executionId: 'practice-b',
                payload: { event }
              })
            );
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
              withTestAdmission(
                context,
                terminal,
                'failed-generation',
                { id: event.slotId },
                engine.execute(terminal, {
                  executionId: 'failed-generation',
                  payload: { id: event.slotId }
                })
              )
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
              yield* withTestAdmission(
                context,
                practiceFailureWorkflow,
                'record-failure',
                { event: failedEvent },
                engine.execute(practiceFailureWorkflow, {
                  executionId: 'record-failure',
                  payload: { event: failedEvent }
                })
              ),
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
              yield* withTestAdmission(
                context,
                practiceFailureWorkflow,
                'stale-failure',
                { event: failedEvent },
                engine.execute(practiceFailureWorkflow, {
                  executionId: 'stale-failure',
                  payload: { event: failedEvent }
                })
              ),
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

            yield* withTestAdmission(
              context,
              practiceSlotWorkflow,
              'practice-retry',
              { event: retryEvent },
              engine.execute(practiceSlotWorkflow, {
                executionId: 'practice-retry',
                payload: { event: retryEvent }
              })
            );
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

            yield* withTestAdmission(
              context,
              practiceSlotWorkflow,
              'practice-second',
              { event: secondEvent },
              engine.execute(practiceSlotWorkflow, {
                executionId: 'practice-second',
                payload: { event: secondEvent }
              })
            );
            const cancelledWorkflow = Workflow.make('practice-cancel-test', {
              payload: { id: Schema.String },
              idempotencyKey: ({ id }) => id
            });
            const gate = DurableDeferred.make('practice-cancel-gate');

            yield* engine.register(cancelledWorkflow, () => DurableDeferred.await(gate));
            yield* withTestAdmission(
              context,
              cancelledWorkflow,
              'cancelled-generation',
              { id: secondEvent.slotId },
              engine.execute(cancelledWorkflow, {
                executionId: 'cancelled-generation',
                payload: { id: secondEvent.slotId },
                discard: true
              })
            );

            yield* pollUntil(
              engine.poll(cancelledWorkflow, 'cancelled-generation'),
              Option.isSome,
              {
                attempts: 500,
                interval: '10 millis',
                message: 'Cancelled generation did not start'
              }
            );

            yield* cancelExecution(context, [cancelledWorkflow], {
              id: executionIdSchema.make('cancelled-generation'),
              mode: 'safe'
            });
            yield* reconcileCancellation(
              context,
              cancelledWorkflow,
              'cancelled-generation',
              'safe',
              true
            );
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

            expect(
              context.db.orm
                .select()
                .from(s.workflow_executions)
                .where(eq(s.workflow_executions.execution_id, 'cancelled-generation'))
                .get()?.status
            ).toBe('cancelled');
            expect(cancelledSlot.status).toBe('failed');
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
            const versionId = yield* withTestAdmission(
              context,
              publisher,
              'practice-generate',
              { id: event.slotId },
              engine.execute(publisher, {
                executionId: 'practice-generate',
                payload: { id: event.slotId }
              })
            );
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
              yield* withTestAdmission(
                context,
                practicePublicationWorkflow,
                'attach-practice',
                { event: publication },
                engine.execute(practicePublicationWorkflow, {
                  executionId: 'attach-practice',
                  payload: { event: publication }
                })
              ),
              true
            );
            assert.strictEqual(
              yield* withTestAdmission(
                context,
                practicePublicationWorkflow,
                'attach-practice-again',
                { event: publication },
                engine.execute(practicePublicationWorkflow, {
                  executionId: 'attach-practice-again',
                  payload: { event: publication }
                })
              ),
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
              content: {
                kind: 'flashcards',
                cards: [{ front: 'flowchart TD\nA-->B', back: 'Answer' }]
              }
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
              yield* withTestAdmission(
                context,
                practicePublicationWorkflow,
                'manual-practice',
                { event: manual },
                engine.execute(practicePublicationWorkflow, {
                  executionId: 'manual-practice',
                  payload: { event: manual }
                })
              ),
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
