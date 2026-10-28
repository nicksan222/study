import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { savePreferences as opSavePreferences } from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';
import { completeMaterial } from '#testing/procedures';

test('dueCards returns due flashcards with their artifact metadata', async (t) => {
  const f = await createBackendTest(t);
  const project = opCreateProject(f.store, 'Physics');

  completeMaterial(f.store, project.id);
  const result = await f.caller.practice.dueCards({ limit: 10 });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.artifactTitle, 'Cards');
  assert.equal(result.items[0]?.projectId, BigInt(project.id));
  await assert.rejects(f.caller.practice.dueCards({ limit: 10001 }), { kind: 'invalid_input' });
  opSavePreferences(f.store, 'review', { newCardsPerDay: 0 });
  assert.deepEqual((await f.caller.practice.dueCards({})).items, []);
});
