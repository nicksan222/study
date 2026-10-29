import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { storeFetched } from '#server/procedures/sources/operations/source';
import { saveDocument } from '#server/procedures/sources/operations/source-document';
import { Evidence } from '#server/runtime/grounding';
import { document } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

test('link evidence cites the fetched source snapshot while caching the requested link', async (t) => {
  const f = await createServerTest(t);
  const project = await f.caller.projects.createProject({ name: 'Evidence' });
  const link = await f.caller.sources.addLink({
    project: project.id,
    url: 'https://example.com/article'
  });
  const fetched = storeFetched(f.store, link.id, {
    name: 'Article snapshot',
    bytes: Buffer.from('<p>Evidence</p>'),
    kind: 'web',
    mime: 'text/html',
    uri: link.uri
  })!;

  saveDocument(f.store, fetched.id, document);
  const evidence = new Evidence(f.store, project.id);
  const loaded = evidence.source(link.id)!;

  assert.ok(loaded.text.includes(document.blocks[0]!.text));
  assert.equal(evidence.source(link.id), loaded);
  const citations = evidence.text('Supported [1]').citations;

  assert.equal(citations[0]?.sourceId, fetched.id);
  assert.equal(citations[0]?.sourceName, fetched.name);
  assert.equal(citations[0]?.quote, document.blocks[0]!.text);
});

test('generation evidence pins the exact consumed document version even when identical text is re-extracted', async (t) => {
  const f = await createServerTest(t);
  const project = await f.caller.projects.createProject({ name: 'P' });
  const source = await f.caller.sources.createNote({
    project: project.id,
    title: 'Note',
    text: 'Gravity attracts masses'
  });
  const first = saveDocument(f.store, source.id, document);
  const expected = f.store.db.orm
    .select()
    .from(s.material_document_versions)
    .where(eq(s.material_document_versions.document_id, first))
    .get()!;
  const evidence = new Evidence(f.store, project.id);

  assert.ok(evidence.source(source.id));
  const second = saveDocument(f.store, source.id, document);

  assert.notEqual(second, first);
  const citation = evidence.text('Gravity [1]').citations[0]!;

  assert.equal('inputVersionId' in citation ? citation.inputVersionId : null, expected.version_id);
});
