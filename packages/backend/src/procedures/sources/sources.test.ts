import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { createNote as dbCreateNote } from './create-note.ts';
test('sources lists persisted sources in newest first order', async (t) => {
  const f = await fixture(t);

  dbCreateNote(f.store, 'first', 'a');
  dbCreateNote(f.store, 'second', 'b');
  const listed = await f.caller.sources.sources({});

  assert.deepEqual(
    listed.items.map((item) => item.name),
    ['second', 'first']
  );
});
