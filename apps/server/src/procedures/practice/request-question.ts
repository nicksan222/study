import { sql } from '@study/db';
import * as schema from '@study/db/schema';

import { enqueueJob as opEnqueueJob } from '#server/procedures/jobs/worker';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { PracticeId } from '#server/shared/ids';
import type { QuestionId, JobId } from '#server/shared/ids';
import type { QuestionKind } from '#server/shared/study/types';

import { now } from './finish-question.ts';

export function practiceDependencies(
  ctx: ServerContext,
  id: PracticeId,
  question: QuestionId
): JobId[] {
  return ctx.db.orm
    .all(
      sql`SELECT j.id FROM jobs j WHERE j.status IN ('blocked','queued','waiting','running') AND ((j.kind IN ('fetch','extract') AND j.source_id IN (SELECT s.id FROM sources s JOIN practices p ON p.project_id=s.project_id WHERE p.id=${id})) OR (j.kind='question' AND j.question_id IN (SELECT q.id FROM practice_questions q WHERE q.practice_id=${id} AND q.ordinal < (SELECT ordinal FROM practice_questions WHERE id=${question})))) ORDER BY j.id`
    )
    .map((r) => r.id as JobId);
}

export function requestQuestion(
  ctx: ServerContext,
  id: PracticeId,
  kind: QuestionKind
): {
  questionId: QuestionId;
  jobId: JobId;
} {
  if (kind !== 'choice' && kind !== 'open')
    throw new StudyError('invalid_input', 'invalid question kind');

  return ctx.transaction(() => {
    const questionId = ctx.db.orm
      .insert(schema.practice_questions)
      .values({
        practice_id: id,
        ordinal: sql`(SELECT COALESCE(MAX(ordinal),-1)+1 FROM practice_questions WHERE practice_id=${id})`,
        kind: kind,
        status: 'pending',
        created_at: now()
      })
      .run().lastInsertRowid as QuestionId;
    const jobId = opEnqueueJob(ctx, {
      kind: 'question',
      target: {
        type: 'question',
        id: questionId
      },
      after: practiceDependencies(ctx, id, questionId)
    });

    return {
      questionId,
      jobId
    };
  });
}
