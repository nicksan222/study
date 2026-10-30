import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { QuizAnswerSubmitted } from '@study/contracts/events';
import type { QuizAttemptId, QuizChoiceId } from '@study/contracts/ids';
import { eq } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option } from 'effect';

import { Materials } from '#server/features/materials/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { Learning } from './index.ts';

test('missing attempts are optional or typed failures', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const learning = yield* Learning;
        const id = 999n as QuizAttemptId;

        assert.ok(Option.isNone(yield* learning.findAttempt(id)));
        assert.equal((yield* Effect.flip(learning.attempt(id))).kind, 'not_found');
      }).pipe(
        Effect.provide(
          Learning.layer
            .pipe(Layer.provideMerge(Settings.layer), Layer.provideMerge(Materials.layer))
            .pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })))
        )
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('quiz submissions preserve snapshots, validate ownership and emit a durable event', async () => {
  const { eq, sql } = await import('@study/db');
  const s = await import('@study/db/schema');
  const { decodeEvent, emitEvent } = await import('#server/platform/workflows/events');
  const { transaction } = await import('#server/platform/definitions/define-store');
  const { AttemptStore } = await import('#server/features/learning/store/index');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const db = context.db.orm;

  try {
    const project = db
      .insert(s.projects)
      .values({ name: 'P', created_at: 1n, updated_at: 1n })
      .returning()
      .get()!;
    const material = db
      .insert(s.materials)
      .values({ project_id: project.id, kind: 'quiz', title: 'Q', created_at: 1n, updated_at: 1n })
      .returning()
      .get()!;
    const version = db
      .insert(s.material_versions)
      .values({
        material_id: material.id,
        project_id: project.id,
        kind: 'quiz',
        number: 1n,
        created_at: 1n
      })
      .returning()
      .get()!;

    db.insert(s.material_quiz_versions).values({ version_id: version.id }).run();
    const q = db
      .insert(s.material_quiz_questions)
      .values({
        version_id: version.id,
        position: 0n,
        kind: 'open',
        prompt: 'Question',
        explanation: 'Explanation'
      })
      .returning()
      .get()!;

    db.insert(s.material_quiz_open_answers)
      .values({ question_id: q.id, reference_answer: 'Reference' })
      .run();
    const choiceQuestion = db
      .insert(s.material_quiz_questions)
      .values({
        version_id: version.id,
        position: 1n,
        kind: 'single_choice',
        prompt: 'Choice',
        explanation: 'Explanation'
      })
      .returning()
      .get()!;
    const choice = db
      .insert(s.material_quiz_choices)
      .values({
        question_id: choiceQuestion.id,
        question_kind: 'single_choice',
        position: 0n,
        text: 'Correct',
        is_correct: true
      })
      .returning()
      .get()!;

    db.insert(s.material_quiz_choices)
      .values({
        question_id: choiceQuestion.id,
        question_kind: 'single_choice',
        position: 1n,
        text: 'Incorrect',
        is_correct: false
      })
      .run();
    db.update(s.material_versions)
      .set({ status: 'published', published_at: 1n })
      .where(eq(s.material_versions.id, version.id))
      .run();
    const otherProject = db
      .insert(s.projects)
      .values({ name: 'Other', created_at: 1n, updated_at: 1n })
      .returning()
      .get();
    const otherMaterial = db
      .insert(s.materials)
      .values({
        project_id: otherProject.id,
        kind: 'quiz',
        title: 'Other',
        created_at: 1n,
        updated_at: 1n
      })
      .returning()
      .get();
    const otherVersion = db
      .insert(s.material_versions)
      .values({
        material_id: otherMaterial.id,
        project_id: otherProject.id,
        kind: 'quiz',
        number: 1n,
        created_at: 1n
      })
      .returning()
      .get();

    db.insert(s.material_quiz_versions).values({ version_id: otherVersion.id }).run();
    const otherQuestion = db
      .insert(s.material_quiz_questions)
      .values({
        version_id: otherVersion.id,
        position: 0n,
        kind: 'open',
        prompt: 'Other',
        explanation: 'Other'
      })
      .returning()
      .get();

    db.insert(s.material_quiz_open_answers)
      .values({ question_id: otherQuestion.id, reference_answer: 'Other reference' })
      .run();
    db.update(s.material_versions)
      .set({ status: 'published', published_at: 1n })
      .where(eq(s.material_versions.id, otherVersion.id))
      .run();
    const nextVersion = db
      .insert(s.material_versions)
      .values({
        material_id: material.id,
        project_id: project.id,
        kind: 'quiz',
        number: 2n,
        created_at: 1n
      })
      .returning()
      .get();

    db.insert(s.material_quiz_versions).values({ version_id: nextVersion.id }).run();
    const nextQuestion = db
      .insert(s.material_quiz_questions)
      .values({
        version_id: nextVersion.id,
        position: 0n,
        kind: 'open',
        prompt: 'Next',
        explanation: 'Next'
      })
      .returning()
      .get();

    db.insert(s.material_quiz_open_answers)
      .values({ question_id: nextQuestion.id, reference_answer: 'Next reference' })
      .run();
    db.update(s.material_versions)
      .set({ status: 'published', published_at: 1n })
      .where(eq(s.material_versions.id, nextVersion.id))
      .run();
    await Effect.runPromise(
      Effect.gen(function* () {
        const learning = yield* Learning;
        const a = yield* learning.startQuiz({ versionId: version.id });
        const input = {
          attemptId: a.id,
          questionId: q.id,
          answer: { type: 'open' as const, answer: 'answer' }
        };

        yield* learning.answerQuestion(input);
        yield* learning.answerQuestion({
          attemptId: a.id,
          questionId: choiceQuestion.id,
          answer: { type: 'choice', choiceIds: [choice.id] }
        });
        const event = decodeEvent(db.select().from(s.workflowEvents).all()[0]!.payload);

        assert.equal(event.type, 'QuizAnswerSubmitted');
        assert.equal(event.type === 'QuizAnswerSubmitted' && event.attemptId, a.id);
        assert.equal(
          (yield* Effect.flip(
            learning.answerQuestion({
              ...input,
              answer: {
                type: 'choice',
                choiceIds: [1n as QuizChoiceId]
              }
            })
          )).kind,
          'invalid_input'
        );

        if (event.type !== 'QuizAnswerSubmitted') throw new Error('wrong event');

        const otherAttempt = yield* learning.startQuiz({ versionId: otherVersion.id });

        assert.equal(
          (yield* Effect.flip(learning.answerQuestion({ ...input, questionId: otherQuestion.id })))
            .kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(learning.gradingSnapshot({ ...event, attemptId: otherAttempt.id })))
            .kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(learning.gradingSnapshot({ ...event, questionId: otherQuestion.id })))
            .kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(learning.answerQuestion({ ...input, questionId: nextQuestion.id })))
            .kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(learning.gradingSnapshot({ ...event, questionId: nextQuestion.id })))
            .kind,
          'invalid_input'
        );
        const snapshot = yield* learning.gradingSnapshot(event);

        assert.equal(snapshot.prompt, 'Question');
        assert.equal(snapshot.referenceAnswer, 'Reference');
        assert.equal(snapshot.learnerAnswer, 'answer');
        assert.equal(snapshot.versionId, version.id);
        assert.equal(snapshot.projectId, project.id);
        assert.equal(
          (yield* Effect.flip(learning.gradingSnapshot({ ...event, eventId: 'forged' }))).kind,
          'invalid_input'
        );

        const grade = {
          attemptId: a.id,
          questionId: q.id,
          expectedAnswerHash: event.answerHash,
          score: 0.5,
          feedback: 'Good'
        };

        yield* transaction((tx) => tx.store(AttemptStore).publishGrade(grade)).pipe(
          Effect.provideService(Database, { store: context })
        );
        yield* transaction((tx) =>
          tx.store(AttemptStore).publishGrade({ ...grade, score: 1 })
        ).pipe(Effect.provideService(Database, { store: context }));
        assert.equal(db.select().from(s.material_quiz_responses).get()?.score, 0.5);
        yield* learning.answerQuestion({
          ...input,
          answer: { type: 'open', answer: 'new answer' }
        });
        assert.equal(
          (yield* Effect.flip(
            transaction((tx) => tx.store(AttemptStore).publishGrade(grade)).pipe(
              Effect.provideService(Database, { store: context })
            )
          )).kind,
          'invalid_input'
        );
        db.run(
          sql`CREATE TRIGGER reject_quiz_event BEFORE INSERT ON workflow_events BEGIN SELECT RAISE(ABORT, 'rejected'); END`
        );
        yield* Effect.flip(
          learning.answerQuestion({ ...input, answer: { type: 'open', answer: 'rolled back' } })
        );
        assert.equal(db.select().from(s.material_quiz_responses).get()?.answer, 'new answer');
        db.run(sql`DROP TRIGGER reject_quiz_event`);
        yield* learning.gradeResponse({
          attemptId: a.id,
          questionId: q.id,
          score: 0.5,
          feedback: 'Good'
        });
        const done = yield* learning.finishQuiz({ attemptId: a.id });

        assert.equal(done.questions[0]?.score, 0.5);
        assert.equal(done.questions[1]?.score, 1);
        assert.equal((yield* Effect.flip(learning.answerQuestion(input))).kind, 'invalid_input');
        assert.equal(db.select().from(s.workflowEvents).all().length, 2);

        for (const [index, questionId] of [q.id, nextQuestion.id].entries()) {
          const foreignEvent: QuizAnswerSubmitted = {
            ...event,
            eventId: `foreign-${index}`,
            attemptId: otherAttempt.id,
            questionId
          };

          context.transaction(() => emitEvent(context, foreignEvent, Date.now()));
          assert.equal(
            (yield* Effect.flip(learning.gradingSnapshot(foreignEvent))).kind,
            'invalid_input'
          );
        }
      }).pipe(
        Effect.provide(
          Learning.layer
            .pipe(Layer.provideMerge(Settings.layer), Layer.provideMerge(Materials.layer))
            .pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })))
        )
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('daily allowance limits new cards and review schedules persist', async () => {
  const s = await import('@study/db/schema');
  const { eq } = await import('@study/db');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const db = context.db.orm;

  try {
    const project = db
      .insert(s.projects)
      .values({ name: 'P', created_at: 1n, updated_at: 1n })
      .returning()
      .get()!;
    const material = db
      .insert(s.materials)
      .values({
        project_id: project.id,
        kind: 'flashcards',
        title: 'Deck',
        created_at: 1n,
        updated_at: 1n
      })
      .returning()
      .get()!;
    const version = db
      .insert(s.material_versions)
      .values({
        material_id: material.id,
        project_id: project.id,
        kind: 'flashcards',
        number: 1n,
        created_at: 1n
      })
      .returning()
      .get()!;

    db.insert(s.material_flashcard_versions)
      .values({ version_id: version.id, material_id: material.id })
      .run();

    for (let i = 0; i < 2; i++) {
      const card = db
        .insert(s.material_card_identities)
        .values({ material_id: material.id })
        .returning()
        .get()!;

      db.insert(s.material_flashcard_entries)
        .values({
          version_id: version.id,
          material_id: material.id,
          card_id: card.id,
          position: BigInt(i),
          front: 'front',
          back: 'back'
        })
        .run();
    }

    db.update(s.material_versions)
      .set({ status: 'published', published_at: 1n })
      .where(eq(s.material_versions.id, version.id))
      .run();
    db.insert(s.preferences).values({ scope: 'review', key: 'newCardsPerDay', value: '1' }).run();
    await Effect.runPromise(
      Effect.gen(function* () {
        const learning = yield* Learning;
        const page = yield* learning.dueCards({ projectId: project.id, limit: 10 });

        assert.equal(page.items.length, 1);
        const settings = yield* Settings;

        yield* settings.saveReviewSettings({ newCardsPerDay: 2 });
        assert.equal(
          (yield* learning.dueCards({ projectId: project.id, limit: 10 })).items.length,
          2
        );
        yield* settings.saveReviewSettings({ newCardsPerDay: 1 });
        const cardId = page.items[0]!.snapshot.card_id;

        yield* learning.reviewCard({ versionId: version.id, cardId, rating: 'good' });
        assert.equal((yield* learning.card({ versionId: version.id, cardId })).schedule?.reps, 1n);
        assert.equal(
          (yield* learning.reviewHistory({ versionId: version.id, cardId, limit: 10 })).items
            .length,
          1
        );
        assert.equal(
          (yield* learning.dueCards({ projectId: project.id, limit: 10 })).items.length,
          0
        );
      }).pipe(
        Effect.provide(
          Learning.layer
            .pipe(Layer.provideMerge(Settings.layer), Layer.provideMerge(Materials.layer))
            .pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })))
        )
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('practice starts idempotently with two captured pending slots', async () => {
  const s = await import('@study/db/schema');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    const project = context.db.orm
      .insert(s.projects)
      .values({ name: 'Practice', created_at: 1n, updated_at: 1n })
      .returning()
      .get()!;

    await Effect.runPromise(
      Effect.gen(function* () {
        const learning = yield* Learning;
        const materials = yield* Materials;
        const doc = yield* materials.create({
          projectId: project.id,
          title: 'Document',
          content: {
            kind: 'document',
            blocks: [{ kind: 'paragraph', text: 'Study', anchor: { type: 'page', page: 1 } }],
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
        const first = yield* learning.startPractice({
          projectId: project.id,
          inputVersionIds: [doc.version.id]
        });
        const second = yield* learning.startPractice({
          projectId: project.id,
          inputVersionIds: [doc.version.id]
        });

        assert.equal(first.epoch, second.epoch);
        context.db.orm
          .update(s.learning_practice_slots)
          .set({ failure_kind: 'config' })
          .where(eq(s.learning_practice_slots.id, first.slots[0]!.slotId))
          .run();
        const failed = yield* learning.practice({ projectId: project.id });

        assert.equal(failed.slots[0]!.status, 'failed');
        assert.equal(failed.slots[0]!.failureKind, 'config');
        const retried = yield* learning.retryPracticeQuestion({ slotId: first.slots[0]!.slotId });

        assert.equal(retried.status, 'pending');
        assert.equal(retried.slotId, first.slots[0]!.slotId);
        yield* learning.retryPracticeQuestion({ slotId: first.slots[0]!.slotId });
        assert.deepEqual(
          first.slots.map((slot) => slot.kind),
          ['choice', 'choice']
        );
        assert.deepEqual(
          first.slots.map((slot) => slot.slotId),
          second.slots.map((slot) => slot.slotId)
        );
        assert.equal(
          context.db.orm
            .select()
            .from(s.workflowEvents)
            .all()
            .filter((event) => event.type === 'PracticeSlotRequested').length,
          3
        );
        const stopped = yield* learning.stopPractice({ projectId: project.id });

        assert.equal(stopped.enabled, false);
        assert.equal(stopped.slots.length, 0);
        yield* materials.openGenerationScope({ scopeId: first.epoch!, projectId: project.id });
        assert.equal(
          (yield* Effect.flip(
            materials.requestMaterialGenerationOnce({
              requestId: first.slots[0]!.slotId,
              request: {
                projectId: project.id,
                title: 'Question',
                kind: 'quiz',
                inputVersionIds: [doc.version.id],
                scopeId: first.epoch!,
                questionSpec: { count: 1, kind: 'choice' }
              }
            })
          )).kind,
          'invalid_input'
        );
        const restarted = yield* learning.startPractice({
          projectId: project.id,
          inputVersionIds: [doc.version.id]
        });

        assert.notEqual(restarted.epoch, first.epoch);
        assert.equal(restarted.slots.length, 2);
      }).pipe(
        Effect.provide(
          Learning.layer
            .pipe(Layer.provideMerge(Settings.layer), Layer.provideMerge(Materials.layer))
            .pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })))
        )
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
