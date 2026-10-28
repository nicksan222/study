import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

test('theme library imports, selects, exports and safely deletes', async (t) => {
  const f = await createBackendTest(t);
  const json = JSON.stringify({
    version: 1,
    id: 'custom-ocean',
    name: 'Ocean',
    colors: { primary: '#123456' }
  });

  assert.equal((await f.caller.themes.list()).length, 6);
  await f.caller.themes.import({ json });
  await assert.rejects(f.caller.themes.import({ json }));
  await f.caller.themes.select({ id: 'custom-ocean' });
  assert.equal(await f.caller.themes.selected(), 'custom-ocean');
  assert.deepEqual(
    JSON.parse(await f.caller.themes.export({ id: 'custom-ocean' })),
    JSON.parse(json)
  );
  await assert.rejects(f.caller.themes.import({ json: 'invalid' }));
  assert.equal(await f.caller.themes.selected(), 'custom-ocean');
  await f.caller.themes.delete({ id: 'custom-ocean' });
  assert.equal(await f.caller.themes.selected(), null);
  await assert.rejects(f.caller.themes.select({ id: 'missing' }));
  assert.equal((await f.caller.themes.list()).length, 6);
});

test('saved theme and selection survive reopening the database', async (t) => {
  const f = await createBackendTest(t);
  const json = JSON.stringify({
    version: 1,
    id: 'persist',
    name: 'Persist',
    light: { primary: 'red' }
  });

  await f.caller.themes.save({ json });
  await f.caller.themes.select({ id: 'persist' });
  const { BackendContext } = await import('#backend/runtime/context');
  const { find, selected } = await import('./library.ts');
  const reopened = BackendContext.open(f.store.db.path);

  try {
    assert.equal(find(reopened, 'persist')?.name, 'Persist');
    assert.equal(selected(reopened), 'persist');
  } finally {
    reopened.close();
  }
});

test('a failed transaction rolls back imported themes and selection', async (t) => {
  const f = await createBackendTest(t);
  const { save, select, find, selected } = await import('./library.ts');
  const json = JSON.stringify({ version: 1, id: 'rollback', name: 'Rollback' });

  assert.throws(() =>
    f.store.transaction(() => {
      save(f.store, json, false);
      select(f.store, 'rollback');

      throw new Error('abort');
    })
  );
  assert.equal(find(f.store, 'rollback'), undefined);
  assert.equal(selected(f.store), null);
});
