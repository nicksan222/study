import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createRecording as opCreateRecording } from './create-recording.ts';
import { recording as opRecording } from './recording.ts';
test('deleteRecording removes an existing recording', async (t) => {
  const f = await fixture(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const r = opCreateRecording(f.store, s.id);

  assert.equal(
    (
      await f.caller.recordings.deleteRecording({
        id: r.id
      })
    ).value,
    true
  );
  assert.equal(opRecording(f.store, r.id), null);
  assert.equal(
    (
      await f.caller.recordings.deleteRecording({
        id: r.id
      })
    ).value,
    false
  );
});
