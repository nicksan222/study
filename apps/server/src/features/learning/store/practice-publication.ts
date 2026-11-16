/** @file Owns practice publication within this feature. */

import type { MaterialVersionId } from '@study/contracts';
import { contentInputKey, materialGenerationPayloadSchema } from '@study/contracts';
import * as s from '@study/db';
import { and, eq, inArray } from '@study/db';
import { invalid } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makeAnswerQuestion } from './answer-question.ts';
import { makePracticeQueries } from './practice-queries.ts';
import { slots } from './practice-schemas.ts';
import { makeQuiz } from './quiz.ts';
import { makeStartQuiz } from './start-quiz.ts';

export function makePracticePublication(resources: StoreResources) {
  const { db } = resources;
  const { view, control, activeSlot } = makePracticeQueries(resources);
  const { answerQuestion } = makeAnswerQuestion(resources);

  const { attemptView } = makeQuiz(resources);

  const { startQuiz } = makeStartQuiz(resources);

  function assertPublicationIntent(row: typeof slots.$inferSelect, slotId: string) {
    const request = db.orm
      .select()
      .from(s.material_generation_requests)
      .where(eq(s.material_generation_requests.id, slotId))
      .get();

    if (!request || request.project_id !== row.project_id)
      invalid('invalid practice generation intent');

    const intent = Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema))
    )(request.payload);

    const captured = view(row).inputs;

    if (
      intent.kind !== 'quiz' ||
      intent.scopeId !== row.epoch ||
      intent.questionSpec?.count !== 1 ||
      intent.questionSpec.kind !== row.kind ||
      intent.inputs.length !== captured.length ||
      intent.inputs.some((input, i) => contentInputKey(input) !== contentInputKey(captured[i]!))
    )
      invalid('invalid practice generation intent');
  }

  function assertRetrySlot(row: typeof slots.$inferSelect | undefined) {
    if (
      !row ||
      !control(row.project_id)?.enabled ||
      control(row.project_id)?.epoch !== row.epoch ||
      row.status !== 'pending'
    )
      invalid('practice slot is inactive');

    return row;
  }

  /** Accept only the exact choice or open question kind requested by an endless practice slot. */
  function publish(slotId: string, versionId: MaterialVersionId) {
    const row = db.orm.select().from(slots).where(eq(slots.id, slotId)).get();

    if (!row) return null;

    if (row.version_id !== null) {
      if (row.version_id !== versionId || row.attempt_id === null)
        invalid('practice publication conflict');

      return attemptView(row.attempt_id);
    }

    if (!activeSlot(slotId)) return null;

    const version = db.orm
      .select()
      .from(s.material_versions)
      .where(
        and(
          eq(s.material_versions.id, versionId),
          inArray(
            s.material_versions.material_id,
            db.orm
              .select({ id: s.project_materials.material_id })
              .from(s.project_materials)
              .where(eq(s.project_materials.project_id, row.project_id))
          ),
          eq(s.material_versions.kind, 'quiz'),
          eq(s.material_versions.status, 'published'),
          eq(s.material_versions.generation_request_id, slotId)
        )
      )
      .get();

    assertPublicationIntent(row, slotId);

    const questions = db.orm
      .select()
      .from(s.material_quiz_questions)
      .where(eq(s.material_quiz_questions.version_id, versionId))
      .all();

    if (
      !version ||
      questions.length !== 1 ||
      (row.kind === 'open'
        ? questions[0]!.kind !== 'open'
        : !['single_choice', 'multiple_choice'].includes(questions[0]!.kind))
    )
      invalid('invalid practice quiz publication');

    const attempt = startQuiz({ versionId });

    db.orm
      .update(slots)
      .set({ status: 'ready', version_id: versionId, attempt_id: attempt.id })
      .where(eq(slots.id, slotId))
      .run();

    return attempt;
  }

  return { publish, assertRetrySlot, attemptView, answerQuestion };
}
