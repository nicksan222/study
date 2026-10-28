import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { listProjects as opListProjects } from '#backend/procedures/projects/operations/read-projects';
import { createNote as opCreateNote } from '#backend/procedures/sources/operations/create-note';
import { sourceBytes as opSourceBytes } from '#backend/procedures/sources/operations/source';
import { listSources as opListSources } from '#backend/procedures/sources/operations/sources';
import { App } from '#backend/runtime/service';
import { createBackendTest } from '#testing/backend-test';

test('projects and notes persist in an isolated database', async (t) => {
  const testDatabase = createBackendTest(t, { app: false });

  const app = createBackendTest(t, { app: false }).manage(
    await App.open({ path: testDatabase.path })
  );

  let noteId: ReturnType<typeof opCreateNote>['id'];

  try {
    const project = opCreateProject(app.store, 'Physics');
    const note = opCreateNote(app.store, 'Notes', 'Hello', project.id);

    noteId = note.id;
    assert.equal(opListSources(app.store)[0]?.id, note.id);
  } finally {
    await app.close();
  }

  const reopened = createBackendTest(t, { app: false }).manage(
    await App.open({ path: testDatabase.path })
  );

  assert.equal(opListProjects(reopened.store)[0]?.name, 'Physics');
  assert.equal(new TextDecoder().decode(opSourceBytes(reopened.store, noteId)!), 'Hello');
});

test('cancelling sign-in closes its listener and leaves the account signed out', async (t) => {
  const testDatabase = createBackendTest(t, { app: false });
  const app = createBackendTest(t, { app: false }).manage(
    await App.open({ path: testDatabase.path })
  );

  try {
    const { url } = await app.startSignIn();

    assert.equal(new URL(url).hostname, 'auth.openai.com');
    const pending = app.finishSignIn();

    app.cancelSignIn();
    await assert.rejects(pending);
    assert.equal(app.signInStatus().signedIn, false);
  } finally {
    await app.close();
  }
});
