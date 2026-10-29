import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listSources as dbListSources } from '#server/procedures/sources/operations/sources';
import { createServerTest } from '#testing/server-test';
test('createNote persists note content and queues extraction', async (t) => {
  const f = await createServerTest(t);
  const note = await f.caller.sources.createNote({
    title: 'Lecture',
    text: 'Key idea'
  });

  assert.equal(note.name, 'Lecture');
  assert.equal(note.kind, 'note');
  assert.equal(dbListSources(f.store).find((source) => source.name === note.name)?.sizeBytes, 8n);
});
