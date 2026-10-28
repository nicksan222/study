import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createRecording as opCreateRecording } from '#backend/procedures/recordings/operations/create-recording';
import { createBackendTest } from '#testing/backend-test';

test('recordings lists persisted recordings', async (t) => {
  const f = await createBackendTest(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const r = opCreateRecording(f.store, s.id);
  const out = await f.caller.recordings.recordings({});

  assert.deepEqual(
    out.items.map((x) => x.id),
    [r.id]
  );
});
