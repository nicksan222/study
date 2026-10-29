import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#server/procedures/conversations/operations/create-session';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { createRecording as opCreateRecording } from '#server/procedures/recordings/operations/create-recording';
import { recording as opRecording } from '#server/procedures/recordings/operations/recording';
import { createServerTest } from '#testing/server-test';

test('deleteRecording removes an existing recording', async (t) => {
  const f = await createServerTest(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const r = opCreateRecording(f.store, s.id);

  assert.equal((await f.caller.recordings.deleteRecording({ id: r.id })).value, true);
  assert.equal(opRecording(f.store, r.id), null);
  assert.equal((await f.caller.recordings.deleteRecording({ id: r.id })).value, false);
});
