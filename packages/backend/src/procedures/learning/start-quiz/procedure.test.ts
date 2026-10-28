import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setup, seedQuiz, noLeaks } from '#backend/procedures/learning/test-support';

test('startQuiz creates independent redacted attempts for published versions', async (t) => {
  const f = await setup(t),
    q = seedQuiz(f);
  const one = await f.learning.startQuiz({ versionId: q.versionId });
  const two = await f.learning.startQuiz({ versionId: q.versionId });

  assert.notEqual(one.id, two.id);
  assert.equal(one.status, 'in_progress');
  assert.equal(one.questions.length, 3);
  noLeaks(one);
  await assert.rejects(f.learning.startQuiz({ versionId: 99999n }), { kind: 'not_found' });
});

test('startQuiz rejects draft versions', async (t) => {
  const f = await setup(t),
    draft = seedQuiz(f, undefined, false);

  await assert.rejects(f.learning.startQuiz({ versionId: draft.versionId }), { kind: 'not_found' });
});
