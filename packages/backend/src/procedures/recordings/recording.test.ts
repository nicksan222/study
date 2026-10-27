import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { appendRecording } from './append-recording.ts';
import { createRecording as opCreateRecording } from './create-recording.ts';
test('recording returns a stored recording or empty optional', async (t) => {
  const f = await fixture(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const r = opCreateRecording(f.store, s.id);

  assert.equal(
    (
      await f.caller.recordings.recording({
        id: r.id
      })
    ).value?.id,
    r.id
  );
  assert.equal(
    (
      await f.caller.recordings.recording({
        id: 999999n
      })
    ).value,
    null
  );
});

test('recording metadata counts samples across chunks without mixing recordings', async (t) => {
  const f = await fixture(t);
  const session = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const first = opCreateRecording(f.store, session.id);
  const other = opCreateRecording(f.store, session.id);

  assert.equal((await f.caller.recordings.recording({ id: first.id })).value?.samples, 0n);
  appendRecording(f.store, first.id, Int16Array.from([-32768, 0, 32767]));
  appendRecording(f.store, first.id, Int16Array.from([-1, 1]));
  appendRecording(f.store, other.id, Int16Array.from([10]));

  assert.equal((await f.caller.recordings.recording({ id: first.id })).value?.samples, 5n);
  assert.equal((await f.caller.recordings.recording({ id: other.id })).value?.samples, 1n);
  const listed = await f.caller.recordings.recordings({});

  assert.deepEqual(
    listed.items.map((item) => item.samples),
    [5n, 1n]
  );
});
