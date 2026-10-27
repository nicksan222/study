import assert from 'node:assert/strict';
import test from 'node:test';

import * as schema from '@study/db/schema';

import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { listMessages as opListMessages } from '#backend/procedures/conversations/messages';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { source as opSource } from '#backend/procedures/sources/source';
import { fixture } from '#testing/procedures';

import { appendRecording as opAppendRecording } from './append-recording.ts';
import { createRecording as opCreateRecording } from './create-recording.ts';
import { recording as opRecording } from './recording.ts';
test('postRecording creates a message with a recording source', async (t) => {
  const f = await fixture(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const r = opCreateRecording(f.store, s.id);

  opAppendRecording(f.store, r.id, new Int16Array([1, 2, 3]));
  await f.caller.recordings.postRecording({
    session: s.id,
    recording: r.id,
    name: 'Lecture'
  });
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
    f.caller.recordings.postRecording({
      session: s.id,
      recording: r.id,
      name: 'Missing'
    }),
    (error: { kind?: string }) => error.kind === 'not_found'
  );
  await assert.rejects(
    f.caller.recordings.postRecording({
      session: s.id,
      recording: 999999n,
      name: 'Missing'
    }),
    (error: { kind?: string }) => error.kind === 'not_found'
  );
});
