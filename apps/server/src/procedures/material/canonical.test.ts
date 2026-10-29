import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { originalVersion } from '#server/procedures/ingestion/source-material';
import { createProject } from '#server/procedures/projects/operations/create-project';
import { createNote } from '#server/procedures/sources/operations/create-note';
import { saveDocument } from '#server/procedures/sources/operations/source-document';
import { storeSource } from '#server/procedures/sources/operations/upload-source';
import { document } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

import { canonicalEvidence } from './canonical.ts';

test('link citations resolve fetched document snapshots instead of the original URL material', async (t) => {
  const f = await createServerTest(t),
    p = createProject(f.store, 'Physics');
  const link = storeSource(f.store, {
    projectId: p.id,
    name: 'Web',
    kind: 'link',
    origin: 'web',
    mime: 'text/uri-list',
    uri: 'https://example.com',
    bytes: Buffer.from('https://example.com')
  });
  const original = originalVersion(f.store, link.id)!;
  const fetched = storeSource(
    f.store,
    {
      projectId: p.id,
      name: 'Page',
      kind: 'web',
      origin: 'web',
      mime: 'text/html',
      uri: 'https://example.com',
      bytes: Buffer.from('<p>Gravity attracts masses</p>')
    },
    { inputs: [original.id] }
  );
  const doc = saveDocument(f.store, fetched.id, document);
  const version = f.store.db.orm
    .select()
    .from(s.material_document_versions)
    .where(eq(s.material_document_versions.document_id, doc))
    .get()!.version_id;
  const evidence = canonicalEvidence(
    f.store,
    p.id,
    [link.id],
    [
      {
        marker: 1,
        sourceId: link.id,
        sourceName: 'Web',
        quote: 'Gravity attracts masses',
        anchor: { type: 'paragraph', index: 0 }
      }
    ]
  );

  assert.deepEqual(evidence.inputs, [version]);
  assert.equal(evidence.citations[0]?.inputVersionId, version);
});

test('evidence falls back to known original versions and excludes foreign or missing sources', async (t) => {
  const f = await createServerTest(t),
    p = createProject(f.store, 'P'),
    other = createProject(f.store, 'Other');
  const a = createNote(f.store, 'A', 'A', p.id),
    foreign = createNote(f.store, 'Foreign', 'Foreign', other.id);
  const original = originalVersion(f.store, a.id)!;
  const evidence = canonicalEvidence(
    f.store,
    p.id,
    [a.id, foreign.id, 999n],
    [
      {
        marker: 1,
        sourceId: a.id,
        sourceName: 'A',
        quote: 'A',
        anchor: { type: 'paragraph', index: 0 }
      },
      {
        marker: 2,
        sourceId: foreign.id,
        sourceName: 'Foreign',
        quote: 'Foreign',
        anchor: { type: 'paragraph', index: 0 }
      }
    ]
  );

  assert.deepEqual(evidence.inputs, [original.id]);
  assert.deepEqual(
    evidence.citations.map((c) => c.marker),
    [1n]
  );
});

test('explicit citation versions disambiguate identical historical document passages', async (t) => {
  const f = await createServerTest(t),
    p = createProject(f.store, 'Physics'),
    source = createNote(f.store, 'A', 'Gravity attracts masses', p.id);
  const old = saveDocument(f.store, source.id, document);
  const oldVersion = f.store.db.orm
    .select()
    .from(s.material_document_versions)
    .where(eq(s.material_document_versions.document_id, old))
    .get()!.version_id;

  saveDocument(f.store, source.id, {
    ...document,
    meta: { ...document.meta, provider: 'new extraction' }
  });
  const evidence = canonicalEvidence(
    f.store,
    p.id,
    [source.id],
    [
      {
        marker: 1,
        sourceId: source.id,
        sourceName: 'A',
        quote: 'Gravity attracts masses',
        anchor: { type: 'paragraph', index: 0 },
        inputVersionId: oldVersion
      }
    ]
  );

  assert.deepEqual(evidence.inputs, [oldVersion]);
  assert.equal(evidence.citations[0]?.inputVersionId, oldVersion);
});
