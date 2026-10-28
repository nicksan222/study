import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as s from '@study/db/schema';
import { and, eq } from 'drizzle-orm';

import { learningRouter } from '#backend/procedures/learning/router';
import { readMaterial } from '#backend/procedures/materials/reads';
import { createProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';
import { completeQuestion } from '#testing/procedures';

test('completed practice questions publish typed agent quizzes usable by the learning router', async (t) => {
  const f = await createBackendTest(t),
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
