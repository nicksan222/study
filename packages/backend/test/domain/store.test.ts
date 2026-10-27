import assert from 'node:assert/strict';
import { mkdtempSync, statSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { listSessions as opListSessions } from '#backend/procedures/conversations/all-sessions';
import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { createUntitledSession as opCreateUntitledSession } from '#backend/procedures/conversations/create-untitled-session';
import { deleteSession as opDeleteSession } from '#backend/procedures/conversations/delete-session';
import {
  setGeneratedTitle as opSetGeneratedTitle,
  replaceWithGeneratedTitle as opReplaceWithGeneratedTitle
} from '#backend/procedures/conversations/regenerate-title';
import { session as opSession } from '#backend/procedures/conversations/session';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { deleteProject as opDeleteProject } from '#backend/procedures/projects/delete-project';
import {
  listProjects as opListProjects,
  project as opProject
} from '#backend/procedures/projects/projects';
import { renameProject as opRenameProject } from '#backend/procedures/projects/rename-project';
import { setExam as opSetExam } from '#backend/procedures/projects/set-exam';
import { addLink as opAddLink } from '#backend/procedures/sources/add-link';
import { createNote as opCreateNote } from '#backend/procedures/sources/create-note';
import { deleteSource as opDeleteSource } from '#backend/procedures/sources/delete-source';
import {
  storeFetched as opStoreFetched,
  source as opSource
} from '#backend/procedures/sources/source';
import { saveDocument as opSaveDocument } from '#backend/procedures/sources/source-document';
import { listSources as opListSources } from '#backend/procedures/sources/sources';
import { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';

function fixture(fn: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'study-backend-'));

  try {
    fn(join(dir, 'study.sqlite3'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('opens a private WAL database and reopens it', () =>
  fixture((path) => {
    const store = BackendContext.open(path);
    const raw = new DatabaseSync(path);

    assert.equal(raw.prepare('pragma journal_mode').get()?.journal_mode, 'wal');

    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);

    raw.close();
    store.close();

    if (process.platform !== 'win32') {
      chmodSync(path, 0o644);
      const reopened = BackendContext.open(path);

      assert.equal(statSync(path).mode & 0o777, 0o600);
      reopened.close();
    }
  }));
test('projects persist, validate names, and roll back transactions', () =>
  fixture((path) => {
    let store = BackendContext.open(path);
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
    store = BackendContext.open(path);
    assert.equal(opProject(store, a.id)?.name, 'New');
    assert.equal(opProject(store, a.id)?.examOn, '2026-10-20');
    assert.equal(opDeleteProject(store, a.id), true);
    assert.equal(opDeleteProject(store, a.id), false);
    store.close();
  }));
test('session title provenance and project cascade', () =>
  fixture((path) => {
    const store = BackendContext.open(path);
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
test('deleted subjects never reuse ids for stale work', () =>
  fixture((path) => {
    const store = BackendContext.open(path);
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
test('validation uses classified invalid input and leaves data intact', () =>
  fixture((path) => {
    const store = BackendContext.open(path);
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
test('nested writes roll back with outer transaction', () =>
  fixture((path) => {
    const store = BackendContext.open(path);
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
test('async transaction callbacks cannot write after rollback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-async-'));
  const store = BackendContext.open(join(dir, 'study.sqlite3'));

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
    rmSync(dir, { recursive: true, force: true });
  }
});
test('a failed nested savepoint can be caught without losing outer writes', () =>
  fixture((path) => {
    const store = BackendContext.open(path);

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
