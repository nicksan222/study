import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { postMessage as opPostMessage } from '#backend/procedures/conversations/operations/post-message';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';
import { completeMaterial } from '#testing/procedures';
test('materialChanges reports changed notes and returns empty for an unknown artifact', async (t) => {
  const f = await createBackendTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const made = completeMaterial(f.store, project.id);
  const result = await f.caller.material.materialChanges({
    id: BigInt(made.artifactId)
  });

  assert.equal(result.value?.files, 0);
  assert.equal(result.value?.notes, 0);
  const session = opCreateSession(f.store, project.id, 'New lecture');

  opPostMessage(f.store, {
    sessionId: session.id,
    text: 'Mass attracts masses'
  });
  const changed = await f.caller.material.materialChanges({
    id: BigInt(made.artifactId)
  });

  assert.equal(changed.value?.notes, 1);
  assert.equal(
    (
      await f.caller.material.materialChanges({
        id: 999999n
      })
    ).value,
    null
  );
});
