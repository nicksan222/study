import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture, completeMaterial } from '#testing/procedures';

import { cardReviews as opCardReviews } from './review.ts';
test('reviewTimes lists persisted review timestamps with project filtering', async (t) => {
  const f = await fixture(t);
  const project = opCreateProject(f.store, 'Physics');
  const other = opCreateProject(f.store, 'Other');
  const card = completeMaterial(f.store, project.id).card;

  completeMaterial(f.store, other.id);
  await f.caller.practice.review({
    card: BigInt(card.id),
    rating: 3
  });
  const result = await f.caller.practice.reviewTimes({
    project: BigInt(project.id),
    since: 0n
  });

  assert.deepEqual(
    result.items,
    opCardReviews(f.store, card.id).map((review) => review.reviewedAt)
  );
  assert.equal(
    (
      await f.caller.practice.reviewTimes({
        project: BigInt(other.id),
        since: 0n
      })
    ).items.length,
    0
  );
});
