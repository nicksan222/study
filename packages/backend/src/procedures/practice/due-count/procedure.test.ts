import assert from 'node:assert/strict';
import { test } from 'node:test';

import { newCardAllowance } from '#backend/procedures/practice/operations/due-count';
import { reviewCard } from '#backend/procedures/practice/operations/review';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { savePreferences as opSavePreferences } from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';
import { completeMaterial } from '#testing/procedures';

test('dueCount respects project scope and the new card allowance', async (t) => {
  const f = await createBackendTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const other = opCreateProject(f.store, 'Other');

  completeMaterial(f.store, project.id);
  completeMaterial(f.store, other.id);
  assert.equal((await f.caller.practice.dueCount({ project: BigInt(project.id) })).value, 1);
  assert.equal((await f.caller.practice.dueCount({})).value, 2);
  opSavePreferences(f.store, 'review', { newCardsPerDay: 0 });
  assert.equal((await f.caller.practice.dueCount({})).value, 0);
});

test('daily allowance counts first reviews once and ignores earlier days', async (t) => {
  const f = await createBackendTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const old = completeMaterial(f.store, project.id);
  const today = completeMaterial(f.store, opCreateProject(f.store, 'Other').id);
  const midnight = new Date();

  midnight.setHours(0, 0, 0, 0);
  const start = BigInt(Math.floor(midnight.getTime() / 1000));
  const at = BigInt(Math.floor(Date.now() / 1000));

  opSavePreferences(f.store, 'review', { newCardsPerDay: 2 });
  reviewCard(f.store, old.card.id, 'good', start - 1n);
  reviewCard(f.store, old.card.id, 'good', at);
  assert.equal(newCardAllowance(f.store), 2);
  reviewCard(f.store, today.card.id, 'good', at);
  reviewCard(f.store, today.card.id, 'good', at);
  assert.equal(newCardAllowance(f.store), 1);
});
