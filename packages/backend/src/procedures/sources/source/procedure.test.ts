import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNote as dbCreateNote } from '#backend/procedures/sources/operations/create-note';
import { createBackendTest } from '#testing/backend-test';
test('source returns a stored source and omits a missing source', async (t) => {
  const f = await createBackendTest(t);
  const created = dbCreateNote(f.store, 'n', 'body');

  assert.equal(
    (
      await f.caller.sources.source({
        id: created.id
      })
    ).value?.name,
    'n'
  );
  assert.equal(
    (
      await f.caller.sources.source({
        id: 999999n
      })
    ).value,
    null
  );
  await assert.rejects(
    f.caller.sources.source({
      id: 0n
    }),
    {
      kind: 'invalid_input'
    }
  );
});
