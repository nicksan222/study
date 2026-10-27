import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { job as dbJob } from '#backend/procedures/jobs/job';
import { listJobs as dbListJobs } from '#backend/procedures/jobs/job-overviews';
import { retryJob as dbRetryJob } from '#backend/procedures/jobs/retry-job';
import {
  enqueueJob as dbEnqueueJob,
  claimJob as dbClaimJob,
  failJob as dbFailJob
} from '#backend/procedures/jobs/worker';
import { createProject as dbCreateProject } from '#backend/procedures/projects/create-project';
import { deleteProject as dbDeleteProject } from '#backend/procedures/projects/delete-project';
import {
  loadPreferences as dbLoadPreferences,
  setPreference as dbSetPreference,
  deletePreference as dbDeletePreference,
  savePreferences as dbSavePreferences
} from '#backend/procedures/settings/preferences';
import { addLink as dbAddLink } from '#backend/procedures/sources/add-link';
import { correctBlock as dbCorrectBlock } from '#backend/procedures/sources/correct-block';
import { createNote as dbCreateNote } from '#backend/procedures/sources/create-note';
import { deleteSource as dbDeleteSource } from '#backend/procedures/sources/delete-source';
import { exportSource as dbExportSource } from '#backend/procedures/sources/export-source-to-file';
import { importSource as dbImportSource } from '#backend/procedures/sources/import-file';
import { setSourceProject as dbSetSourceProject } from '#backend/procedures/sources/set-source-project';
import {
  source as dbSource,
  storeFetched as dbStoreFetched,
  sourceBytes as dbSourceBytes,
  readSourceBounded as dbReadSourceBounded,
  readSourcePrefix as dbReadSourcePrefix
} from '#backend/procedures/sources/source';
import {
  saveDocument as dbSaveDocument,
  document as dbDocument,
  sourceOfDocument as dbSourceOfDocument
} from '#backend/procedures/sources/source-document';
import { listSources as dbListSources } from '#backend/procedures/sources/sources';
import { BackendContext } from '#backend/runtime/context';
import { StudyError, classifyError } from '#backend/shared/errors/index';
import type { Document } from '#backend/shared/sources/document';
import { sniff, viewerExtension } from '#backend/shared/sources/sniff';

function fixture(fn: (store: BackendContext, dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'study-sources-'));
  const store = BackendContext.open(join(dir, 'study.sqlite3'));

  try {
    fn(store, dir);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('imports duplicate bytes as distinct sources and exports them', () =>
  fixture((store, dir) => {
    const p = dbCreateProject(store, 'Physics');
    const input = join(dir, 'notes.txt');

    writeFileSync(input, 'hello');
    const a = dbImportSource(store, input, p.id);
    const b = dbImportSource(store, input, null);

    assert.notEqual(a.id, b.id);
    assert.deepEqual(a.sha256, b.sha256);
    assert.equal(a.projectName, 'Physics');
    assert.equal(a.kind, 'text');
    assert.equal(Buffer.from(dbSourceBytes(store, a.id)!).toString(), 'hello');
    const output = join(dir, 'export.txt');

    dbExportSource(store, a.id, output);
    assert.equal(readFileSync(output, 'utf8'), 'hello');
    assert.equal(dbListSources(store).length, 2);
    assert.throws(() => dbDeleteSource(store, a.id));
    assert.equal(Buffer.from(dbSourceBytes(store, a.id)!).toString(), 'hello');
    assert.equal(dbSetSourceProject(store, b.id, p.id), true);
    assert.throws(() => dbDeleteSource(store, b.id));
    assert.equal(Buffer.from(dbSourceBytes(store, b.id)!).toString(), 'hello');
  }));
test('notes and documents roundtrip, reject stale edits, and cascade', () =>
  fixture((store) => {
    const note = dbCreateNote(store, 'Ideas', 'the sell divides', null);

    assert.equal(note.kind, 'note');
    assert.equal(Buffer.from(dbSourceBytes(store, note.id)!).toString(), 'the sell divides');
    const doc: Document = {
      blocks: [
        {
          kind: 'paragraph',
          text: 'the sell divides',
          anchor: { type: 'page', page: 2 }
        }
      ],
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
    };
    const first = dbSaveDocument(store, note.id, doc);

    assert.deepEqual(dbDocument(store, first), doc);
    assert.equal(dbCorrectBlock(store, note.id, first, 0, 'stale', 'new'), null);
    const second = dbCorrectBlock(
      store,
      note.id,
      first,
      0,
      'the sell divides',
      ' the cell divides '
    )!;

    assert.deepEqual(dbDocument(store, first), doc);
    assert.equal(dbDocument(store, second)?.blocks[0].text, 'the cell divides');
    assert.equal(dbDocument(store, second)?.meta.corrected, true);
    assert.equal(dbSourceOfDocument(store, second), note.id);
    assert.equal(dbDeleteSource(store, note.id), true);
    assert.equal(dbDocument(store, second), null);
  }));
test('preferences roundtrip, replace scopes and remove single keys', () =>
  fixture((store) => {
    dbSetPreference(store, 'reader', 'choice', 'local');
    dbSetPreference(store, 'reader', 'count', 3);
    dbSetPreference(store, 'other', 'ok', true);
    assert.deepEqual(dbLoadPreferences(store, 'reader'), {
      choice: 'local',
      count: 3
    });
    dbSavePreferences(store, 'reader', {
      value: null,
      nested: { a: [1, false] }
    });
    assert.deepEqual(dbLoadPreferences(store, 'reader'), {
      value: null,
      nested: { a: [1, false] }
    });
    dbDeletePreference(store, 'reader', 'value');
    assert.deepEqual(dbLoadPreferences(store, 'reader'), {
      nested: { a: [1, false] }
    });
    assert.deepEqual(dbLoadPreferences(store, 'other'), { ok: true });
  }));
test('sniffing prioritizes content and keeps office zip formats', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

  assert.deepEqual(sniff('notes.pdf', png), {
    kind: 'image',
    mime: 'image/png'
  });
  assert.equal(sniff('x.pptx', Buffer.from('504b0304140000000000', 'hex')).kind, 'slides');
  assert.equal(sniff('a.csv', Buffer.from('a,b')).kind, 'spreadsheet');
  assert.equal(sniff('README', Buffer.from('hello')).kind, 'text');
  assert.equal(sniff('binary', Buffer.from([0, 1])).kind, 'other');
  assert.equal(viewerExtension('code', 'text/plain'), 'txt');
  assert.equal(viewerExtension('image', 'image/svg+xml'), null);
});
test('classified errors preserve domain and filesystem kinds', () => {
  assert.equal(classifyError(new StudyError('rate_limited', 'busy')).kind, 'rate_limited');
  assert.equal(
    classifyError(Object.assign(new Error('missing'), { code: 'ENOENT' })).kind,
    'not_found'
  );
});
test('links are replaced atomically and bounded reads enforce limits', () =>
  fixture((store) => {
    const link = dbAddLink(store, null, ' https://example.org/a ');

    assert.equal(link.kind, 'link');
    assert.equal(link.uri, 'https://example.org/a');
    const fetched = dbStoreFetched(store, link.id, {
      name: 'page.html',
      bytes: Buffer.from('<p>hello</p>'),
      kind: 'web',
      mime: 'text/html',
      uri: 'https://example.org/a'
    });

    assert.equal(fetched?.id, link.id);
    assert.equal(fetched?.kind, 'web');
    assert.equal(dbReadSourceBounded(store, link.id, 2), null);
    assert.equal(Buffer.from(dbReadSourcePrefix(store, link.id, 3)).toString(), '<p>');
    assert.throws(() =>
      dbStoreFetched(store, link.id, {
        name: 'again',
        bytes: Buffer.from('x'),
        kind: 'text',
        mime: 'text/plain',
        uri: null
      })
    );
  }));
test('preference replacement rolls back on invalid JSON values', () =>
  fixture((store) => {
    dbSavePreferences(store, 's', { good: 'kept' });
    assert.throws(() => dbSavePreferences(store, 's', { invalid: undefined as never }));
    assert.deepEqual(dbLoadPreferences(store, 's'), { good: 'kept' });
  }));
test('source writes and document replacement roll back on constraint errors', () =>
  fixture((store) => {
    const p = dbCreateProject(store, 'Project');
    const source = dbCreateNote(store, 'note', 'body', p.id);
    const doc: Document = {
      blocks: [{ kind: 'paragraph', text: 'ok', anchor: { type: 'page', page: 1 } }],
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
    };
    const id = dbSaveDocument(store, source.id, doc);

    assert.throws(() =>
      dbSaveDocument(store, source.id, {
        ...doc,
        blocks: [{ ...doc.blocks[0], kind: 'bad' as never }]
      })
    );
    assert.deepEqual(dbDocument(store, id), doc);
    dbDeleteProject(store, p.id);
    assert.equal(dbSource(store, source.id), null);
    assert.equal(dbDocument(store, id), null);
  }));

test('document identity prevents correction of a replaced document with identical text', () =>
  fixture((store) => {
    const src = dbCreateNote(store, 'N', 'x');
    const doc: Document = {
      blocks: [{ kind: 'paragraph', text: 'same', anchor: { type: 'page', page: 1 } }],
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
    };
    const old = dbSaveDocument(store, src.id, doc);
    const current = dbSaveDocument(store, src.id, {
      ...doc,
      blocks: [{ ...doc.blocks[0], anchor: { type: 'page', page: 2 } }]
    });

    assert.equal(dbCorrectBlock(store, src.id, old, 0, 'same', 'wrong'), null);
    assert.equal(dbDocument(store, current)?.blocks[0].text, 'same');
  }));
test('bounded read checks blob length rather than stale metadata', () =>
  fixture((store, dir) => {
    const s = dbCreateNote(store, 'N', 'abcdef');
    const raw = new DatabaseSync(join(dir, 'study.sqlite3'));

    raw.prepare('UPDATE sources SET size_bytes = 1 WHERE id = ?').run(s.id);
    raw.close();
    assert.equal(dbReadSourceBounded(store, s.id, 2), null);
    assert.equal(Buffer.from(dbReadSourceBounded(store, s.id, 6)!).toString(), 'abcdef');
  }));

test('corrections atomically schedule indexing and retire failed extraction', () =>
  fixture((store) => {
    const source = dbCreateNote(store, 'N', 'body');
    const doc: Document = {
      blocks: [{ kind: 'paragraph', text: 'wrong', anchor: { type: 'page', page: 1 } }],
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
    };
    const original = dbSaveDocument(store, source.id, doc);
    const read = dbEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: source.id }
    });

    dbClaimJob(store, ['extract']);
    dbFailJob(store, read, 1n, {
      kind: 'internal',
      message: 'failed',
      retryAfterMs: null
    });
    const corrected = dbCorrectBlock(store, source.id, original, 0, 'wrong', 'right')!;

    assert.equal(dbJob(store, read)?.status, 'cancelled');
    assert.equal(dbRetryJob(store, read), false);
    const index = dbListJobs(store).find((j) => j.kind === 'index');

    assert.deepEqual(index?.target, { type: 'document', id: corrected });
    assert.equal(index?.status, 'queued');
  }));
