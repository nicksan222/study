import assert from 'node:assert/strict';
import test from 'node:test';

import { listAllSessions as dbListAllSessions } from '#server/procedures/conversations/operations/all-sessions';
import { createProject as dbCreateProject } from '#server/procedures/projects/operations/create-project';
import { savePreferences as dbSavePreferences } from '#server/procedures/settings/preferences';
import { createServerTest } from '#testing/server-test';
test('createUntitledSession trims title and marks it provisional', async (t) => {
  const f = await createServerTest(t);
  const p = dbCreateProject(f.store, 'One');
  const out = await f.caller.conversations.createUntitledSession({
    project: p.id,
    title: ' Notes '
  });

  assert.equal(out.title, 'Notes');
  assert.equal(
    dbListAllSessions(f.store).some(
      (session) => session.title === 'Notes' && session.titleSource === 'provisional'
    ),
    true
  );
  dbSavePreferences(f.store, 'app', {
    language: 2
  });
  assert.equal(
    (
      await f.caller.conversations.createUntitledSession({
        project: p.id,
        title: '  '
      })
    ).title,
    'Nuova sessione'
  );
  await assert.rejects(
    f.caller.conversations.createUntitledSession({
      title: 'Missing'
    } as never),
    {
      kind: 'invalid_input'
    }
  );
});
