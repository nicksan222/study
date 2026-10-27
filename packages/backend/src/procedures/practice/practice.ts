import * as schema from '@study/db/schema';
import { sql, desc } from 'drizzle-orm';
import { z } from 'zod';

import { targetJobs } from '#backend/procedures/jobs/job-overviews';
import { retryJob as opRetryJob } from '#backend/procedures/jobs/retry-job';
import { enqueueJob as opEnqueueJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { PracticeId } from '#backend/shared/ids';
import type { QuestionId, JobId } from '#backend/shared/ids';
import type { Anchor } from '#backend/shared/sources/document';
import type { PracticeBody } from '#backend/shared/study/types';
import type { PracticeQuestion } from '#backend/shared/study/types';

import { listPractices as opListPractices } from './practices.ts';
import {
  practiceDependencies as opPracticeDependencies,
  requestQuestion as opRequestQuestion
} from './request-question.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store, wake } = context;
    const id = r.id;
    const p = opListPractices(store).find((p) => p.id === id);

    if (!p)
      return {
        value: null
      };

    const questions = ensurePracticeQuestions(store, id);

    wake();

    return {
      value: {
        id: p.id,
        projectId: p.projectId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        score: practiceScore(store, id),
        questions: questions.map((q) => ({
          ...q,
          job: targetJobs(store, 'question', q.id)[0] ?? null
        }))
      }
    };
  });

export function practiceScore(ctx: BackendContext, id: PracticeId) {
  const r = ctx.db.orm
    .select({
      asked: sql`count(body)`,
      answered: sql`count(answered_at)`,
      correct: sql`coalesce(sum(verdict='correct'),0)`,
      partly: sql`coalesce(sum(verdict='partly'),0)`,
      incorrect: sql`coalesce(sum(verdict='incorrect'),0)`
    })
    .from(schema.practice_questions)
    .where(sql`practice_id=${id}`)
    .get()!;

  return {
    asked: Number(r.asked),
    answered: Number(r.answered),
    correct: Number(r.correct),
    partly: Number(r.partly),
    incorrect: Number(r.incorrect)
  };
}

export function question(ctx: BackendContext, id: QuestionId) {
  const r = ctx.db.orm
    .select()
    .from(schema.practice_questions)
    .where(sql`id=${id}`)
    .get();

  if (!r) return null;

  const citations = ctx.db.orm
    .select()
    .from(schema.question_citations)
    .where(sql`question_id=${id}`)
    .orderBy(schema.question_citations.marker)
    .all()
    .map((c) => ({
      marker: Number(c.marker),
      sourceId: c.source_id,
      sourceName: c.source_name,
      anchor: JSON.parse(c.anchor) as Anchor,
      quote: c.quote
    }));

  return {
    id,
    practiceId: r.practice_id,
    ordinal: r.ordinal,
    kind: r.kind,
    status: r.status,
    body: r.body === null ? null : (JSON.parse(r.body) as PracticeBody),
    gist: r.gist,
    choice: r.choice === null ? null : Number(r.choice),
    answer: r.answer,
    verdict: r.verdict,
    feedback: r.feedback,
    createdAt: r.created_at,
    answeredAt: r.answered_at,
    gradedAt: r.graded_at,
    citations
  };
}

export function listQuestions(ctx: BackendContext, id: PracticeId): PracticeQuestion[] {
  return ctx.db.orm
    .select({
      id: schema.practice_questions.id
    })
    .from(schema.practice_questions)
    .where(sql`practice_id=${id}`)
    .orderBy(schema.practice_questions.ordinal)
    .all()
    .map((r) => question(ctx, r.id)!);
}

export function ensurePracticeQuestions(ctx: BackendContext, id: PracticeId): PracticeQuestion[] {
  return ctx.transaction(() => {
    const questions = listQuestions(ctx, id);

    for (const question of questions) {
      const kind =
        question.status === 'answered'
          ? 'grade'
          : question.status === 'pending' || question.status === 'writing'
            ? 'question'
            : null;

      if (!kind) continue;

      const job = ctx.db.orm
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status
        })
        .from(schema.jobs)
        .where(sql`question_id=${question.id} AND kind=${kind}`)
        .orderBy(desc(schema.jobs.id))
        .limit(1)
        .get();

      if (job && (job.status === 'failed' || job.status === 'cancelled'))
        opRetryJob(ctx, job.id as JobId);

      if (!job || (kind === 'question' && job.status !== 'running' && job.status !== 'succeeded'))
        opEnqueueJob(ctx, {
          kind,
          target: {
            type: 'question',
            id: question.id
          },
          after: kind === 'question' ? opPracticeDependencies(ctx, id, question.id) : []
        });
    }

    topUpPractice(ctx, id);

    return listQuestions(ctx, id);
  });
}

export function topUpPractice(ctx: BackendContext, id: PracticeId): void {
  if (
    !ctx.db.orm
      .select({
        id: schema.practices.id
      })
      .from(schema.practices)
      .where(sql`id=${id}`)
      .get()
  )
    return;

  const waiting = Number(
    ctx.db.orm
      .select({
        n: sql`count(*)`
      })
      .from(schema.practice_questions)
      .where(sql`practice_id=${id} AND status IN ('pending','writing','ready')`)
      .get()!.n
  );

  for (let n = waiting; n < 2; n++) {
    const ordinal = ctx.db.orm
      .select({
        n: sql`coalesce(max(ordinal)+1,0)`
      })
      .from(schema.practice_questions)
      .where(sql`practice_id=${id}`)
      .get()!.n as bigint;

    opRequestQuestion(ctx, id, ordinal % 3n === 2n ? 'open' : 'choice');
  }
}
