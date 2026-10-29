import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq } from '@study/db';
import * as schema from '@study/db/schema';

import { listJobs as opListJobs } from '#server/procedures/jobs/operations/job-overviews';
import { question } from '#server/procedures/practice/operations/practice';
import {
  listQuestions as opListQuestions,
  practiceScore as opPracticeScore
} from '#server/procedures/practice/operations/practice';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { completeQuestion } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';
test('practice returns ensured questions, score and empty for an unknown practice', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const q = completeQuestion(f.store, project.id);
  const p = q.practice;
  const result = await f.caller.practice.practice({
    id: BigInt(p.id)
  });

  assert.equal(result.value?.id, BigInt(p.id));
  assert.equal(result.value?.questions.length, opListQuestions(f.store, p.id).length);
  assert.equal(result.value?.score?.asked, opPracticeScore(f.store, p.id).asked);
  assert.equal(result.value?.score?.answered, opPracticeScore(f.store, p.id).answered);
  assert.ok(
    opListJobs(f.store).some((job) => job.kind === 'question' && job.target.type === 'question')
  );
  assert.equal(
    (
      await f.caller.practice.practice({
        id: 999999n
      })
    ).value,
    null
  );
});

test('question reads reject malformed persisted practice bodies', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const made = completeQuestion(f.store, project.id);

  f.store.db.orm
    .update(schema.practice_questions)
    .set({ body: '{"type":"choice","question":42}' })
    .where(eq(schema.practice_questions.id, made.questionId))
    .run();
  assert.throws(() => question(f.store, made.questionId));
});
