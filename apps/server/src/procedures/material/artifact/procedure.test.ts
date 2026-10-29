import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq } from '@study/db';
import * as schema from '@study/db/schema';

import { artifact, cards } from '#server/procedures/material/operations/artifact';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { completeMaterial } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';
test('artifact returns the stored artifact and an empty optional for a missing id', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const made = completeMaterial(f.store, project.id);
  const result = await f.caller.material.artifact({
    id: BigInt(made.artifactId)
  });

  assert.equal(result.value?.title, 'Cards');
  assert.equal(result.value?.id, BigInt(made.artifactId));
  assert.equal(
    (
      await f.caller.material.artifact({
        id: 999999n
      })
    ).value,
    null
  );
});

test('artifact readers reject malformed persisted bodies and card citations', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const made = completeMaterial(f.store, project.id);

  f.store.db.orm
    .update(schema.artifacts)
    .set({ body: '{"type":"flashcards","cards":"invalid"}' })
    .where(eq(schema.artifacts.id, made.artifactId))
    .run();
  assert.throws(() => artifact(f.store, made.artifactId));
  f.store.db.orm
    .update(schema.cards)
    .set({ cites: '["not-a-marker"]' })
    .where(eq(schema.cards.artifact_id, made.artifactId))
    .run();
  assert.throws(() => cards(f.store, made.artifactId));
});
