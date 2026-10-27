import assert from 'node:assert/strict';
import test from 'node:test';

import { createProject as dbCreateProject } from '#backend/procedures/projects/create-project';
import { savePreferences as dbSavePreferences } from '#backend/procedures/settings/preferences';
import { fixture } from '#testing/procedures';

import { listAllSessions as dbListAllSessions } from './all-sessions.ts';
test('createUntitledSession trims title and marks it provisional', async (t) => {
  const f = await fixture(t);
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
