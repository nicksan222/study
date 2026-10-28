import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNote as dbCreateNote } from '#backend/procedures/sources/operations/create-note';
import { createBackendTest } from '#testing/backend-test';
test('exportSource returns stored bytes', async (t) => {
  const f = await createBackendTest(t);
  const source = dbCreateNote(f.store, 'n', 'bytes');
  const response = await f.caller.sources.exportSource({
    id: source.id
  });

  assert.equal(response.value.length, 5);
  await assert.rejects(
    f.caller.sources.exportSource({
      id: 0n
    }),
    {
      kind: 'invalid_input'
    }
  );
});
