import assert from 'node:assert/strict';
import test from 'node:test';

import * as schema from '@study/db/schema';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { listMessages as opListMessages } from '#backend/procedures/conversations/operations/messages';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { appendRecording as opAppendRecording } from '#backend/procedures/recordings/operations/append-recording';
import { createRecording as opCreateRecording } from '#backend/procedures/recordings/operations/create-recording';
import { recording as opRecording } from '#backend/procedures/recordings/operations/recording';
import { source as opSource } from '#backend/procedures/sources/operations/source';
import { createBackendTest } from '#testing/backend-test';

test('postRecording creates a message with a recording source', async (t) => {
  const f = await createBackendTest(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const r = opCreateRecording(f.store, s.id);

  opAppendRecording(f.store, r.id, new Int16Array([1, 2, 3]));
  await f.caller.recordings.postRecording({ session: s.id, recording: r.id, name: 'Lecture' });
  const posted = opListMessages(f.store, s.id)[0];

  assert.equal(posted?.parts.length, 1);
  const audio = opSource(f.store, posted!.parts[0]!.sourceId!);

  assert.equal(audio?.origin, 'recording');
  assert.equal(audio?.name, 'Lecture');
  const payload = f.store.db.orm.select().from(schema.material_audio_versions).get();

  assert.equal(payload?.source_id, audio?.id);
  assert.equal(payload?.sample_rate, 16000n);
  assert.equal(payload?.channels, 1n);
  assert.equal(payload?.duration_ms, 0n);
  assert.equal(f.store.db.orm.select().from(schema.session_materials).get()?.session_id, s.id);
  assert.equal(opRecording(f.store, r.id), null);
  const other = opCreateSession(f.store, opCreateProject(f.store, 'Other').id, 'Other chat');
  const otherRecording = opCreateRecording(f.store, other.id);

  opAppendRecording(f.store, otherRecording.id, new Int16Array([7]));
  await assert.rejects(
    f.caller.recordings.postRecording({
      session: s.id,
      recording: otherRecording.id,
      name: 'Wrong session'
    }),
    (error: { kind?: string }) => error.kind === 'invalid_input'
  );
  await assert.rejects(
    f.caller.recordings.postRecording({ session: s.id, recording: r.id, name: 'Missing' }),
    (error: { kind?: string }) => error.kind === 'not_found'
  );
  await assert.rejects(
    f.caller.recordings.postRecording({ session: s.id, recording: 999999n, name: 'Missing' }),
    (error: { kind?: string }) => error.kind === 'not_found'
  );
});
