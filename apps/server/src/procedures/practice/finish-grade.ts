import { sql } from '@study/db';
import * as schema from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { QuestionId, JobId } from '#server/shared/ids';
import type { Verdict } from '#server/shared/study/types';

import {
  now,
  questionJobRunning as opQuestionJobRunning,
  completeQuestionJob as opCompleteQuestionJob
} from './finish-question.ts';
import { question as opQuestion } from './operations/practice.ts';

export function finishGrade(
  ctx: ServerContext,
  id: QuestionId,
  job: JobId,
  attempt: bigint,
  verdict: Verdict,
  feedback: string
): boolean {
  return ctx.transaction(() => {
    const q = opQuestion(ctx, id);

    if (!q || q.status !== 'answered' || !opQuestionJobRunning(ctx, id, job, attempt, 'grade'))
      return false;

    if (!['correct', 'partly', 'incorrect'].includes(verdict) || !feedback.trim())
      throw new StudyError('invalid_input', 'invalid grade');

    ctx.db.orm
      .update(schema.practice_questions)
      .set({
        verdict: verdict,
        feedback: feedback.trim(),
        status: 'graded',
        graded_at: now()
      })
      .where(sql`id=${id}`)
      .run();
    opCompleteQuestionJob(ctx, job);
    ctx.db.orm
      .update(schema.practices)
      .set({
        updated_at: now()
      })
      .where(sql`id=${q.practiceId}`)
      .run();

    return true;
  });
}
