import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { listSources as dbListSources } from './sources.ts';
test('createNote persists note content and queues extraction', async (t) => {
  const f = await fixture(t);
  const note = await f.caller.sources.createNote({
    title: 'Lecture',
    text: 'Key idea'
  });

  assert.equal(note.name, 'Lecture');
  assert.equal(note.kind, 'note');
  assert.equal(dbListSources(f.store).find((source) => source.name === note.name)?.sizeBytes, 8n);
});
