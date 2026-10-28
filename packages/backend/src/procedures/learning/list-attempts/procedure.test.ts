import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setup, seedQuiz } from '#backend/procedures/learning/test-support';

test('listAttempts keyset pagination filters material and project', async (t) => {
  const f = await setup(t),
    q = seedQuiz(f),
    other = seedQuiz(f);
  const one = await f.learning.startQuiz({ versionId: q.versionId });
  const two = await f.learning.startQuiz({ versionId: q.versionId });

  await f.learning.startQuiz({ versionId: other.versionId });
  const page = await f.learning.listAttempts({
    projectId: f.project.id,
    materialId: q.materialId,
    take: 1
  });

  assert.equal(page.items[0]!.attempt.id, two.id);
  const next = await f.learning.listAttempts({
    materialId: q.materialId,
    cursor: page.nextCursor!,
    take: 1
  });

  assert.equal(next.items[0]!.attempt.id, one.id);
  assert.equal(next.nextCursor, null);
  assert.deepEqual((await f.learning.listAttempts({ projectId: 9999n })).items, []);
});
