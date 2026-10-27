import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listJobs as opListJobs } from '#backend/procedures/jobs/job-overviews';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture, completeQuestion } from '#testing/procedures';

import { listQuestions as opListQuestions, practiceScore as opPracticeScore } from './practice.ts';
test('practice returns ensured questions, score and empty for an unknown practice', async (t) => {
  const f = await fixture(t);
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
