import assert from 'node:assert/strict';
import { test } from 'node:test';

import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import { learningRouter } from '#server/procedures/learning/router';
import { readMaterial } from '#server/procedures/materials/reads';
import { createProject } from '#server/procedures/projects/operations/create-project';
import { completeQuestion } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

test('completed practice questions publish typed agent quizzes usable by the learning router', async (t) => {
  const f = await createServerTest(t),
    p = createProject(f.store, 'Physics');

  completeQuestion(f.store, p.id, 'choice');
  completeQuestion(f.store, p.id, 'open');
  const materials = f.store.db.orm
    .select()
    .from(s.materials)
    .where(and(eq(s.materials.project_id, p.id), eq(s.materials.kind, 'quiz')))
    .all();

  assert.equal(materials.length, 2);
  const learning = learningRouter.createCaller(f.context);

  for (const material of materials) {
    const version = readMaterial(f.store, material.id)!.version;

    assert.equal(version.creator, 'agent');
    assert.equal(version.status, 'published');
    assert.equal(version.kind, 'quiz');

    if (version.kind !== 'quiz') throw Error('Expected quiz');

    assert.equal(version.content.questions.length, 1);
    const attempt = await learning.startQuiz({ versionId: version.id });

    assert.ok(attempt.id);
  }
});
