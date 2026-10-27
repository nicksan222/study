import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { listProjects as opListProjects } from '#backend/procedures/projects/projects';
import { createNote as opCreateNote } from '#backend/procedures/sources/create-note';
import { sourceBytes as opSourceBytes } from '#backend/procedures/sources/source';
import { listSources as opListSources } from '#backend/procedures/sources/sources';
import { App } from '#backend/runtime/service';

test('projects and notes persist in an isolated database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-app-'));

  try {
    const app = await App.open({ path: join(dir, 'study.db') });
    const project = opCreateProject(app.store, 'Physics');
    const note = opCreateNote(app.store, 'Notes', 'Hello', project.id);

    assert.equal(opListSources(app.store)[0]?.id, note.id);
    await app.close();
    const reopened = await App.open({ path: join(dir, 'study.db') });

    assert.equal(opListProjects(reopened.store)[0]?.name, 'Physics');
    assert.equal(new TextDecoder().decode(opSourceBytes(reopened.store, note.id)!), 'Hello');
    await reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancelling sign-in closes its listener and leaves the account signed out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-auth-'));
  const app = await App.open({ path: join(dir, 'db') });

  try {
    const { url } = await app.startSignIn();

    assert.equal(new URL(url).hostname, 'auth.openai.com');
    const pending = app.finishSignIn();

    app.cancelSignIn();
    await assert.rejects(pending);
    assert.equal(app.signInStatus().signedIn, false);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
