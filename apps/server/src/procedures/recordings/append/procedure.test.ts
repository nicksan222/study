import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#server/procedures/conversations/operations/create-session';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { createRecording as opCreateRecording } from '#server/procedures/recordings/operations/create-recording';
import { recordingSamples as opRecordingSamples } from '#server/procedures/recordings/operations/recording';
import { createServerTest } from '#testing/server-test';

test('appendRecording stores PCM samples and rejects out-of-range values', async (t) => {
  const f = await createServerTest(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const r = opCreateRecording(f.store, s.id);

  await f.caller.recordings.append({ id: r.id, samples: [-32768, 0, 32767] });
  assert.deepEqual(Array.from(opRecordingSamples(f.store, r.id)), [-32768, 0, 32767]);
  await assert.rejects(
    f.caller.recordings.append({ id: r.id, samples: [32768] }),
    (error: { kind?: string }) => error.kind === 'invalid_input'
  );
});
