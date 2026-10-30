import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type { QuizAnswerSubmitted } from '@study/contracts/events';
import { and, eq, sql } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { decodeEvent, encodeEvent } from '#server/platform/workflows/events';

import { makeQuiz } from './quiz.ts';

export function makeGradingSnapshot(resources: StoreResources) {
  const { db } = resources;
  const { attemptRow, published } = makeQuiz(resources);

  function gradingSnapshot(event: QuizAnswerSubmitted, allowGraded = false) {
    const stale = () => {
      throw new StudyError('invalid_input', 'stale quiz grade');
    };
    const latest = db.orm
      .select({
        payload: s.workflowEvents.payload
      })
      .from(s.workflowEvents)
      .where(
        and(
          eq(s.workflowEvents.type, 'QuizAnswerSubmitted'),
          sql`json_extract(${s.workflowEvents.payload}, '$.attemptId') = ${event.attemptId.toString()}`,
          sql`json_extract(${s.workflowEvents.payload}, '$.questionId') = ${event.questionId.toString()}`
        )
      )
      .orderBy(sql`rowid DESC`)
      .limit(1)
      .get();
    const stored = latest ? decodeEvent(latest.payload) : null;

    if (
      !stored ||
      stored.type !== 'QuizAnswerSubmitted' ||
      encodeEvent(stored) !== encodeEvent(event)
    )
      return stale();

    const attempt = attemptRow(event.attemptId, true);
    const version = published(attempt.version_id, 'quiz');
    const row = db.orm
      .select({
        question: s.material_quiz_questions,
        response: s.material_quiz_responses,
        reference: s.material_quiz_open_answers
      })
      .from(s.material_quiz_questions)
      .innerJoin(
        s.material_quiz_responses,
        and(
          eq(s.material_quiz_responses.question_id, s.material_quiz_questions.id),
          eq(s.material_quiz_responses.version_id, s.material_quiz_questions.version_id),
          eq(s.material_quiz_responses.attempt_id, attempt.id)
        )
      )
      .innerJoin(
        s.material_quiz_open_answers,
        eq(s.material_quiz_open_answers.question_id, s.material_quiz_questions.id)
      )
      .innerJoin(
        s.materials,
        and(
          eq(s.materials.id, version.material_id),
          eq(s.materials.project_id, version.project_id),
          eq(s.materials.kind, version.kind)
        )
      )
      .where(
        and(
          eq(s.material_quiz_questions.id, event.questionId),
          eq(s.material_quiz_questions.version_id, version.id)
        )
      )
      .get();

    if (
      !row ||
      row.question.kind !== 'open' ||
      row.response.question_kind !== 'open' ||
      !row.response.answer?.trim() ||
      !row.reference.reference_answer.trim() ||
      (!allowGraded && row.response.score !== null)
    )
      return stale();

    const hash = createHash('sha256')
      .update(JSON.stringify([row.response.answer, event.eventId]))
      .digest('hex');

    if (hash !== event.answerHash) return stale();

    return {
      attemptId: attempt.id,
      questionId: row.question.id,
      versionId: version.id,
      materialId: version.material_id,
      projectId: version.project_id,
      prompt: row.question.prompt,
      referenceAnswer: row.reference.reference_answer,
      learnerAnswer: row.response.answer
    };
  }

  return {
    gradingSnapshot
  };
}
