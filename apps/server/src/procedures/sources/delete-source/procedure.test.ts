import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNote as dbCreateNote } from '#server/procedures/sources/operations/create-note';
import { source as dbSource } from '#server/procedures/sources/operations/source';
import { createServerTest } from '#testing/server-test';
test('deleteSource removes an existing source and returns false for a missing one', async (t) => {
  const f = await createServerTest(t);
  const source = dbCreateNote(f.store, 'n', 'body');

  assert.equal(
    (
      await f.caller.sources.deleteSource({
        id: source.id
      })
    ).value,
    true
  );
  assert.equal(dbSource(f.store, source.id), null);
  assert.equal(
    (
      await f.caller.sources.deleteSource({
        id: source.id
      })
    ).value,
    false
  );
  await assert.rejects(
    f.caller.sources.deleteSource({
      id: 0n
    }),
    {
      kind: 'invalid_input'
    }
  );
});

test('deleteSource rejects published original sources with a typed failure', async (t) => {
  const f = await createServerTest(t);
  const project = await f.caller.projects.createProject({ name: 'Course' });
  const source = dbCreateNote(f.store, 'Published', 'Keep these bytes', project.id);

  await assert.rejects(f.caller.sources.deleteSource({ id: source.id }), { kind: 'invalid_input' });
  assert.equal(dbSource(f.store, source.id)?.name, 'Published');
});
