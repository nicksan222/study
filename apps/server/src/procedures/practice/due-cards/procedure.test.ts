import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { savePreferences as opSavePreferences } from '#server/procedures/settings/preferences';
import { completeMaterial } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

test('dueCards returns due flashcards with their artifact metadata', async (t) => {
  const f = await createServerTest(t);
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
