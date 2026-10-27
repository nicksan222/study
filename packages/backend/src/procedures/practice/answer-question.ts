import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { enqueueJob as opEnqueueJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { JobId } from '#backend/shared/ids';
import type { QuestionId } from '#backend/shared/ids';
import type { PracticeAnswer, PracticeQuestion } from '#backend/shared/study/types';

import { now } from './finish-question.ts';
import { question as opQuestion, topUpPractice as opTopUpPractice } from './practice.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput,
      answer: z.discriminatedUnion('type', [
        z.object({
          type: z.literal('choice'),
          choice: z.number().int().min(0)
        }),
        z.object({
          type: z.literal('open'),
          answer: z.string().min(1)
        })
      ])
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;
    const id = r.id;
    const answer =
      r.answer.type === 'choice'
        ? {
            type: 'choice' as const,
            choice: r.answer.choice
          }
        : {
            type: 'open' as const,
            answer: r.answer.answer
          };
    const result = answerQuestion(store, id, answer);

    if (!result) throw new StudyError('not_found', 'Question missing');

    wake();

    return result.jobId
      ? {
          type: 'grading' as const,
          jobId: result.jobId
        }
      : {
          type: 'graded' as const,
          verdict: result.question.verdict!
        };
  });

export function answerQuestion(
  ctx: BackendContext,
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
