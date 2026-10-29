import assert from 'node:assert/strict';
import { statSync, chmodSync } from 'node:fs';
import { test } from 'node:test';
import type { TestContext } from 'node:test';

import { sql } from '@study/db';

import { listSessions as opListSessions } from '#server/procedures/conversations/operations/all-sessions';
import { createSession as opCreateSession } from '#server/procedures/conversations/operations/create-session';
import { createUntitledSession as opCreateUntitledSession } from '#server/procedures/conversations/operations/create-untitled-session';
import { deleteSession as opDeleteSession } from '#server/procedures/conversations/operations/delete-session';
import {
  setGeneratedTitle as opSetGeneratedTitle,
  replaceWithGeneratedTitle as opReplaceWithGeneratedTitle
} from '#server/procedures/conversations/operations/regenerate-title';
import { session as opSession } from '#server/procedures/conversations/operations/session';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { deleteProject as opDeleteProject } from '#server/procedures/projects/operations/delete-project';
import {
  listProjects as opListProjects,
  project as opProject
} from '#server/procedures/projects/operations/read-projects';
import { renameProject as opRenameProject } from '#server/procedures/projects/operations/rename-project';
import { setExam as opSetExam } from '#server/procedures/projects/operations/set-exam';
import { addLink as opAddLink } from '#server/procedures/sources/operations/add-link';
import { createNote as opCreateNote } from '#server/procedures/sources/operations/create-note';
import { deleteSource as opDeleteSource } from '#server/procedures/sources/operations/delete-source';
import {
  storeFetched as opStoreFetched,
  source as opSource
} from '#server/procedures/sources/operations/source';
import { saveDocument as opSaveDocument } from '#server/procedures/sources/operations/source-document';
import { listSources as opListSources } from '#server/procedures/sources/operations/sources';
import { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import { createServerTest } from '#testing/server-test';

function fixture(t: TestContext, fn: (path: string) => void) {
  const testDatabase = createServerTest(t, { app: false });

  fn(testDatabase.path);
}

test('opens a private WAL database and reopens it', (t) =>
  fixture(t, (path) => {
    const store = createServerTest(t, { app: false }).manage(ServerContext.open(path));

    assert.equal(
      store.db.orm.get<{ journal_mode: string }>(sql`pragma journal_mode`)?.journal_mode,
      'wal'
    );

    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);

    store.close();

    if (process.platform !== 'win32') {
      chmodSync(path, 0o644);
      const reopened = createServerTest(t, { app: false }).manage(ServerContext.open(path));

      assert.equal(statSync(path).mode & 0o777, 0o600);
      reopened.close();
    }
  }));
test('projects persist, validate names, and roll back transactions', (t) =>
  fixture(t, (path) => {
    let store = createServerTest(t, { app: false }).manage(ServerContext.open(path));
    const a = opCreateProject(store, '  Biology  ');
    const b = opCreateProject(store, 'Biology');

    assert.equal(a.name, 'Biology');
    assert.equal(typeof a.id, 'bigint');
    assert.deepEqual(opListProjects(store), [b, a]);
    assert.throws(() => opCreateProject(store, ' '));
    assert.throws(() => opCreateProject(store, 'x'.repeat(101)));
    assert.throws(() =>
      store.transaction(() => {
        opCreateProject(store, 'rollback');

        throw Error('stop');
      })
    );
    assert.equal(opListProjects(store).length, 2);
    assert.equal(opRenameProject(store, a.id, ' New '), true);
    assert.equal(opSetExam(store, a.id, '2026-10-20'), true);
    store.close();
    store = createServerTest(t, { app: false }).manage(ServerContext.open(path));
    assert.equal(opProject(store, a.id)?.name, 'New');
    assert.equal(opProject(store, a.id)?.examOn, '2026-10-20');
    assert.equal(opDeleteProject(store, a.id), true);
    assert.equal(opDeleteProject(store, a.id), false);
    store.close();
  }));
test('session title provenance and project cascade', (t) =>
  fixture(t, (path) => {
    const store = createServerTest(t, { app: false }).manage(ServerContext.open(path));
    const project = opCreateProject(store, 'Biology');
    const first = opCreateUntitledSession(store, project.id, ' draft ');
    const second = opCreateSession(store, project.id, ' Cells ');

    assert.deepEqual(
      opListSessions(store, project.id).map((s) => s.id),
      [second.id, first.id]
    );
    assert.equal(opSetGeneratedTitle(store, first.id, 'Generated'), true);
    assert.equal(opSetGeneratedTitle(store, first.id, 'Again'), false);
    assert.equal(opSetGeneratedTitle(store, second.id, 'No'), false);
    assert.equal(opReplaceWithGeneratedTitle(store, second.id, 'Requested'), true);
    assert.equal(opSession(store, second.id)?.titleSource, 'generated');
    opDeleteProject(store, project.id);
    assert.equal(opSession(store, first.id), null);
    store.close();
  }));
test('deleted subjects never reuse ids for stale work', (t) =>
  fixture(t, (path) => {
    const store = createServerTest(t, { app: false }).manage(ServerContext.open(path));
    const p = opCreateProject(store, 'P');
    const old = opCreateUntitledSession(store, p.id, 'old');

    opDeleteSession(store, old.id);
    const fresh = opCreateUntitledSession(store, p.id, 'new');

    assert.notEqual(fresh.id, old.id);
    assert.equal(opSetGeneratedTitle(store, old.id, 'stale'), false);
    assert.equal(opSession(store, fresh.id)?.title, 'new');
    const link = opAddLink(store, null, 'https://example.com/old');

    opDeleteSource(store, link.id);
    const next = opAddLink(store, null, 'https://example.com/new');

    assert.notEqual(link.id, next.id);
    assert.equal(
      opStoreFetched(store, link.id, {
        name: 'stale',
        bytes: Buffer.from('x'),
        kind: 'text',
        mime: 'text/plain',
        uri: null
      }),
      null
    );
    assert.equal(opSource(store, next.id)?.kind, 'link');
    store.close();
  }));
test('validation uses classified invalid input and leaves data intact', (t) =>
  fixture(t, (path) => {
    const store = createServerTest(t, { app: false }).manage(ServerContext.open(path));
    const p = opCreateProject(store, 'P');
    const s = opCreateSession(store, p.id, 'S');

    for (const work of [
      () => opRenameProject(store, p.id, '  '),
      () => opRenameProject(store, p.id, 'x'.repeat(101)),
      () => opReplaceWithGeneratedTitle(store, s.id, ' '),
      () => opSetExam(store, p.id, '2026-02-29')
    ])
      assert.throws(work, (e: unknown) => e instanceof StudyError && e.kind === 'invalid_input');

    assert.equal(opProject(store, p.id)?.name, 'P');
    assert.equal(opProject(store, p.id)?.examOn, null);
    assert.equal(opSession(store, s.id)?.title, 'S');
    store.close();
  }));
test('nested writes roll back with outer transaction', (t) =>
  fixture(t, (path) => {
    const store = createServerTest(t, { app: false }).manage(ServerContext.open(path));
    let reached = false;

    assert.throws(() =>
      store.transaction(() => {
        const s = opCreateNote(store, 'N', 'body');

        opSaveDocument(store, s.id, {
          blocks: [],
          meta: {
            extractor: null,
            extractorVersion: 0,
            provider: null,
            durationMs: null,
            pageCount: null,
            refiners: [],
            waitingFor: [],
            corrected: false
          }
        });
        reached = true;

        throw Error('rollback');
      })
    );
    assert.equal(reached, true);
    assert.equal(opListSources(store).length, 0);
    store.close();
  }));
test('async transaction callbacks cannot write after rollback', async (t) => {
  const testDatabase = createServerTest(t, { app: false });
  const store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    let invoked = false;

    assert.throws(() =>
      store.transaction((async () => {
        invoked = true;
        await Promise.resolve();
        opCreateProject(store, 'bad');
      }) as never)
    );
    await Promise.resolve();
    assert.equal(invoked, false);
    let rejected = false;

    assert.throws(() =>
      store.transaction(
        () =>
          Promise.resolve().then(() => {
            try {
              opCreateProject(store, 'bad');
            } catch {
              rejected = true;
            }
          }) as never
      )
    );
    await Promise.resolve();
    assert.equal(rejected, true);
    assert.equal(opListProjects(store).length, 0);
  } finally {
    store.close();
  }
});
test('a failed nested savepoint can be caught without losing outer writes', (t) =>
  fixture(t, (path) => {
    const store = createServerTest(t, { app: false }).manage(ServerContext.open(path));

    store.transaction(() => {
      opCreateProject(store, 'kept');
      assert.throws(() =>
        store.transaction(() => {
          opCreateProject(store, 'discarded');

          throw Error('fail');
        })
      );
      opCreateProject(store, 'also kept');
    });
    assert.deepEqual(
      opListProjects(store).map((p) => p.name),
      ['also kept', 'kept']
    );
    store.close();
  }));
