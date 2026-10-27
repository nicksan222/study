import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { listRecordings as opListRecordings } from './recordings.ts';
test('createRecording associates recording with its session', async (t) => {
  const f = await fixture(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const out = await f.caller.recordings.createRecording({
    id: s.id
  });

  assert.equal(out.id, opListRecordings(f.store).at(-1)?.id);
  assert.equal(opListRecordings(f.store).at(-1)?.sessionId, s.id);
  await assert.rejects(
    f.caller.recordings.createRecording({
      id: 999999n
    })
  );
  assert.equal(opListRecordings(f.store).length, 1);
});
