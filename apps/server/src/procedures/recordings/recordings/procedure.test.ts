import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#server/procedures/conversations/operations/create-session';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { createRecording as opCreateRecording } from '#server/procedures/recordings/operations/create-recording';
import { createServerTest } from '#testing/server-test';

test('recordings lists persisted recordings', async (t) => {
  const f = await createServerTest(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const r = opCreateRecording(f.store, s.id);
  const out = await f.caller.recordings.recordings({});

  assert.deepEqual(
    out.items.map((x) => x.id),
    [r.id]
  );
});
