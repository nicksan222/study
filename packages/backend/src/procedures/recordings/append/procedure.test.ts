import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createRecording as opCreateRecording } from '#backend/procedures/recordings/operations/create-recording';
import { recordingSamples as opRecordingSamples } from '#backend/procedures/recordings/operations/recording';
import { createBackendTest } from '#testing/backend-test';

test('appendRecording stores PCM samples and rejects out-of-range values', async (t) => {
  const f = await createBackendTest(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const r = opCreateRecording(f.store, s.id);

  await f.caller.recordings.append({ id: r.id, samples: [-32768, 0, 32767] });
  assert.deepEqual(Array.from(opRecordingSamples(f.store, r.id)), [-32768, 0, 32767]);
  await assert.rejects(
    f.caller.recordings.append({ id: r.id, samples: [32768] }),
    (error: { kind?: string }) => error.kind === 'invalid_input'
  );
});
