import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#server/procedures/conversations/operations/create-session';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { listRecordings as opListRecordings } from '#server/procedures/recordings/operations/recordings';
import { createServerTest } from '#testing/server-test';

test('createRecording associates recording with its session', async (t) => {
  const f = await createServerTest(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const out = await f.caller.recordings.createRecording({ id: s.id });

  assert.equal(out.id, opListRecordings(f.store).at(-1)?.id);
  assert.equal(opListRecordings(f.store).at(-1)?.sessionId, s.id);
  await assert.rejects(f.caller.recordings.createRecording({ id: 999999n }));
  assert.equal(opListRecordings(f.store).length, 1);
});
