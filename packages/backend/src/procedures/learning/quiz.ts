import * as s from '@study/db/schema';
import { and, asc, eq } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { StudyError } from '#backend/shared/errors/index';

export const now = () => BigInt(Math.floor(Date.now() / 1000));

export function published(store: BackendContext, versionId: bigint, kind: 'quiz' | 'flashcards') {
  const version = store.db.orm
    .select()
    .from(s.material_versions)
    .where(
      and(
        eq(s.material_versions.id, versionId),
        eq(s.material_versions.kind, kind),
        eq(s.material_versions.status, 'published')
      )
    )
    .get();

  if (!version) throw new StudyError('not_found', 'published learning version missing');

  return version;
}

export function attemptRow(store: BackendContext, attemptId: bigint, writable = false) {
  const row = store.db.orm
    .select()
    .from(s.material_quiz_attempts)
    .where(eq(s.material_quiz_attempts.id, attemptId))
    .get();

  if (!row) throw new StudyError('not_found', 'quiz attempt missing');

  if (writable && row.status !== 'in_progress') invalid('quiz attempt completed');

  return row;
}

export function questions(store: BackendContext, versionId: bigint) {
  return store.db.orm
    .select()
    .from(s.material_quiz_questions)
    .where(eq(s.material_quiz_questions.version_id, versionId))
    .orderBy(asc(s.material_quiz_questions.position))
    .all();
}

export function choices(store: BackendContext, questionId: bigint) {
  return store.db.orm
    .select()
    .from(s.material_quiz_choices)
    .where(eq(s.material_quiz_choices.question_id, questionId))
    .orderBy(asc(s.material_quiz_choices.position))
    .all();
}

export function choiceScore(
  store: BackendContext,
  question: typeof s.material_quiz_questions.$inferSelect,
  selected: bigint[]
) {
  if (
    !selected.length ||
    (question.kind === 'single_choice' && selected.length !== 1) ||
    new Set(selected).size !== selected.length
  )
    invalid('invalid choice cardinality');

  const options = choices(store, question.id);

  if (selected.some((id) => !options.some((c) => c.id === id)))
    invalid('choice does not belong to question');

  const correct = options.filter((c) => c.is_correct).map((c) => c.id);

  return correct.length === selected.length && correct.every((id) => selected.includes(id)) ? 1 : 0;
}

/** Unfinished attempts expose neither grading feedback nor answer keys. */
export function attemptView(store: BackendContext, attemptId: bigint) {
  const attempt = attemptRow(store, attemptId);
  const version = published(store, attempt.version_id, 'quiz');
  const responses = store.db.orm
    .select()
    .from(s.material_quiz_responses)
    .where(eq(s.material_quiz_responses.attempt_id, attemptId))
    .all();
  const selections = store.db.orm
    .select()
    .from(s.material_quiz_selections)
    .where(eq(s.material_quiz_selections.attempt_id, attemptId))
    .all();
  const snapshot = questions(store, attempt.version_id);
  const questionById = new Map(snapshot.map((q) => [q.id, q]));
  const responseByQuestion = new Map(responses.map((r) => [r.question_id, r]));
  const selectedByQuestion = new Map<bigint, bigint[]>();

  for (const selection of selections) {
    const selected = selectedByQuestion.get(selection.question_id);

    if (selected) selected.push(selection.choice_id);
    else selectedByQuestion.set(selection.question_id, [selection.choice_id]);
  }

  const allChoices = store.db.orm
    .select({ choice: s.material_quiz_choices })
    .from(s.material_quiz_choices)
    .innerJoin(
      s.material_quiz_questions,
      eq(s.material_quiz_questions.id, s.material_quiz_choices.question_id)
    )
    .where(eq(s.material_quiz_questions.version_id, attempt.version_id))
    .orderBy(asc(s.material_quiz_choices.position))
    .all();
  const choicesByQuestion = new Map<bigint, (typeof s.material_quiz_choices.$inferSelect)[]>();

  for (const { choice } of allChoices) {
    const options = choicesByQuestion.get(choice.question_id);

    if (options) options.push(choice);
    else choicesByQuestion.set(choice.question_id, [choice]);
  }

  const items = snapshot.map((q) => {
    const response = responseByQuestion.get(q.id);
    const base = { id: q.id, position: q.position, prompt: q.prompt };

    if (q.kind === 'open')
      return {
        ...base,
        kind: q.kind,
        answer: response ? { type: 'open' as const, answer: response.answer! } : null
      };

    return {
      ...base,
      kind: q.kind,
      answer: response
        ? {
            type: 'choice' as const,
            choiceIds: selectedByQuestion.get(q.id) ?? []
          }
        : null,
      choices: (choicesByQuestion.get(q.id) ?? []).map((c) => ({
        id: c.id,
        position: c.position,
        text: c.text
      }))
    };
  });
  const base = {
    id: attempt.id,
    versionId: attempt.version_id,
    materialId: version.material_id,
    projectId: version.project_id,
    startedAt: attempt.started_at
  };

  if (attempt.status === 'in_progress')
    return { ...base, status: 'in_progress' as const, questions: items };

  const openAnswers = store.db.orm
    .select({
      questionId: s.material_quiz_open_answers.question_id,
      referenceAnswer: s.material_quiz_open_answers.reference_answer
    })
    .from(s.material_quiz_open_answers)
    .innerJoin(
      s.material_quiz_questions,
      eq(s.material_quiz_questions.id, s.material_quiz_open_answers.question_id)
    )
    .where(eq(s.material_quiz_questions.version_id, attempt.version_id))
    .all();
  const referenceByQuestion = new Map(openAnswers.map((a) => [a.questionId, a.referenceAnswer]));

  const results = items.map((item) => {
    const response = responseByQuestion.get(item.id);
    const question = questionById.get(item.id)!;
    const result = {
      explanation: question.explanation,
      score: response?.score ?? null,
      feedback: response?.feedback ?? null,
      grading: !response
        ? ('unanswered' as const)
        : response.score === null
          ? ('ungraded' as const)
          : ('graded' as const)
    };

    if (item.kind === 'open')
      return {
        ...item,
        ...result,
        referenceAnswer: referenceByQuestion.get(item.id) ?? null
      };

    return {
      ...item,
      ...result,
      choices: (choicesByQuestion.get(item.id) ?? []).map((c) => ({
        id: c.id,
        position: c.position,
        text: c.text,
        isCorrect: c.is_correct
      }))
    };
  });
  const graded = results.filter((q) => q.score !== null);

  return {
    ...base,
    status: 'completed' as const,
    finishedAt: attempt.finished_at!,
    questions: results,
    scoring: {
      complete: graded.length === results.length,
      gradedCount: graded.length,
      questionCount: results.length,
      earned: graded.reduce((sum, q) => sum + q.score!, 0),
      score:
        graded.length === results.length && results.length > 0
          ? graded.reduce((sum, q) => sum + q.score!, 0) / results.length
          : null
    }
  };
}

export type QuizAttempt = ReturnType<typeof attemptView>;
