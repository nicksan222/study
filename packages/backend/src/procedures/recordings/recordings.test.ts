import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createRecording as opCreateRecording } from './create-recording.ts';
test('recordings lists persisted recordings', async (t) => {
  const f = await fixture(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const r = opCreateRecording(f.store, s.id);
  const out = await f.caller.recordings.recordings({});

  assert.deepEqual(
    out.items.map((x) => x.id),
    [r.id]
  );
});
