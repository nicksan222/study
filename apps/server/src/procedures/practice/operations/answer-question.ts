import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { enqueueJob as opEnqueueJob } from '#server/procedures/jobs/worker';
import { now } from '#server/procedures/practice/finish-question';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { JobId, QuestionId } from '#server/shared/ids';
import type { PracticeAnswer, PracticeQuestion } from '#server/shared/study/types';

import { question as opQuestion, topUpPractice as opTopUpPractice } from './practice.ts';

export function answerQuestion(
  ctx: ServerContext,
  id: QuestionId,
  input: PracticeAnswer
): {
  question: PracticeQuestion;
  jobId: JobId | null;
} | null {
  return ctx.transaction(() => {
    const q = opQuestion(ctx, id);

    if (!q || q.status !== 'ready' || !q.body) return null;

    if (input.type !== q.kind) throw new StudyError('invalid_input', 'wrong answer kind');

    let jobId: JobId | null = null;
    const t = now();

    if (input.type === 'choice' && q.body.type === 'choice') {
      if (
        !Number.isInteger(input.choice) ||
        input.choice < 0 ||
        input.choice >= q.body.choices.length
      )
        throw new StudyError('invalid_input', 'invalid choice');

      ctx.db.orm
        .update(schema.practice_questions)
        .set({
          choice: BigInt(input.choice),
          status: 'graded',
          answered_at: t,
          graded_at: t,
          verdict: input.choice === q.body.answer ? 'correct' : 'incorrect'
        })
        .where(sql`id=${id}`)
        .run();
    } else if (input.type === 'open') {
      if (!input.answer.trim()) throw new StudyError('invalid_input', 'empty answer');

      ctx.db.orm
        .update(schema.practice_questions)
        .set({
          answer: input.answer.trim(),
          status: 'answered',
          answered_at: t
        })
        .where(sql`id=${id}`)
        .run();
      jobId = opEnqueueJob(ctx, {
        kind: 'grade',
        target: {
          type: 'question',
          id
        }
      });
    }

    ctx.db.orm
      .update(schema.practices)
      .set({
        updated_at: t
      })
      .where(sql`id=${q.practiceId}`)
      .run();
    opTopUpPractice(ctx, q.practiceId);

    return {
      question: opQuestion(ctx, id)!,
      jobId
    };
  });
}
