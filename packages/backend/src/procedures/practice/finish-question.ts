import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { reconcileJobs } from '#backend/procedures/jobs/worker';
import type { CanonicalCitationInput } from '#backend/procedures/material/canonical';
import { canonicalEvidence, writeCanonicalVersion } from '#backend/procedures/material/canonical';
import { required } from '#backend/procedures/materials/reads';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { QuestionId, JobId } from '#backend/shared/ids';
import { validateCitations } from '#backend/shared/sources/citations';
import type { PracticeBody } from '#backend/shared/study/types';

import { question as opQuestion, topUpPractice as opTopUpPractice } from './practice.ts';

export function questionJobRunning(
  ctx: BackendContext,
  id: QuestionId,
  job: JobId,
  attempt: bigint,
  kind: 'question' | 'grade'
): boolean {
  return !!ctx.db.orm
    .select({
      id: schema.jobs.id
    })
    .from(schema.jobs)
    .where(
      sql`id=${job} AND question_id=${id} AND attempts=${attempt} AND status='running' AND kind=${kind}`
    )
    .get();
}

export function completeQuestionJob(ctx: BackendContext, job: JobId): void {
  ctx.db.orm
    .update(schema.jobs)
    .set({
      status: 'succeeded',
      updated_at: now(),
      finished_at: now()
    })
    .where(sql`id=${job}`)
    .run();

  reconcileJobs(ctx);
}

export function finishQuestion(
  ctx: BackendContext,
  id: QuestionId,
  job: JobId,
  attempt: bigint,
  body: PracticeBody,
  gist: string,
  citations: CanonicalCitationInput[]
): boolean {
  return ctx.transaction(() => {
    const question = opQuestion(ctx, id);

    if (
      !question ||
      !['pending', 'writing'].includes(question.status) ||
      !questionJobRunning(ctx, id, job, attempt, 'question')
    )
      return false;

    validateCitations(citations);
    check(body, gist);

    if (body.type !== question.kind) throw new StudyError('invalid_input', 'wrong question kind');

    const practice = required(
      ctx.db.orm
        .select()
        .from(schema.practices)
        .where(sql`id=${question.practiceId}`)
        .get()
    );
    const quizQuestion =
      body.type === 'choice'
        ? {
            kind: 'single_choice' as const,
            prompt: body.question,
            explanation: body.explanation.trim() || body.choices[body.answer],
            choices: body.choices.map((choice, index) => ({
              text: choice,
              isCorrect: index === body.answer
            }))
          }
        : {
            kind: 'open' as const,
            prompt: body.question,
            explanation: body.reference,
            referenceAnswer: body.reference
          };

    writeCanonicalVersion(ctx, {
      projectId: practice.project_id,
      title: gist.trim(),
      content: { kind: 'quiz', questions: [quizQuestion] },
      creator: 'agent',
      operation: 'generate',
      evidence: canonicalEvidence(ctx, practice.project_id, [], citations)
    });

    for (const c of citations)
      ctx.db.orm
        .insert(schema.question_citations)
        .values({
          question_id: id,
          marker: BigInt(c.marker),
          source_id: sql`(SELECT id FROM sources WHERE id=${c.sourceId})`,
          source_name: c.sourceName,
          anchor: JSON.stringify(c.anchor),
          quote: c.quote
        })
        .run();

    ctx.db.orm
      .update(schema.practice_questions)
      .set({
        body: JSON.stringify(body),
        gist: gist.trim(),
        status: 'ready'
      })
      .where(sql`id=${id}`)
      .run();
    completeQuestionJob(ctx, job);
    opTopUpPractice(ctx, question.practiceId);

    return true;
  });
}

export const now = () => BigInt(Math.floor(Date.now() / 1000));

export function check(body: PracticeBody, gist: string): void {
  if (!gist.trim() || gist.includes('\n') || [...gist.trim()].length > 200 || !body.question.trim())
    throw new StudyError('invalid_input', 'invalid question');

  if (body.type === 'choice') {
    if (
      body.choices.length < 2 ||
      body.choices.length > 6 ||
      !Number.isInteger(body.answer) ||
      body.answer < 0 ||
      body.answer >= body.choices.length ||
      body.choices.some((c) => !c.trim()) ||
      new Set(body.choices.map((c) => c.trim().toLowerCase())).size !== body.choices.length
    )
      throw new StudyError('invalid_input', 'invalid choices');
  } else if (body.type !== 'open' || !body.reference.trim())
    throw new StudyError('invalid_input', 'invalid open question');
}
