import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { sourceBytes, storeFetched } from '#server/procedures/sources/operations/source';
import { saveDocument, documentOf } from '#server/procedures/sources/operations/source-document';
import { document } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

test('link fetches and extraction preserve bytes and document snapshots', async (t) => {
  const f = await createServerTest(t),
    caller = f.caller.ingestion;
  const project = await f.caller.projects.createProject({ name: 'Web' });
  const original = await caller.addLink({
    projectId: project.id,
    url: 'https://example.com/article',
    title: 'Article'
  });

  if (original.version.kind !== 'link') throw new Error('Expected link');

  const sourceId = original.version.content.sourceId;
  const fetched = storeFetched(f.store, sourceId, {
    name: 'Article',
    bytes: Buffer.from('<html>Article</html>'),
    kind: 'web',
    mime: 'text/html',
    uri: 'https://example.com/article'
  })!;

  assert.notEqual(fetched.id, sourceId);
  assert.equal(
    Buffer.from(sourceBytes(f.store, sourceId)!).toString(),
    'https://example.com/article'
  );
  const first = saveDocument(f.store, fetched.id, document);
  const second = saveDocument(f.store, fetched.id, {
    ...document,
    blocks: document.blocks.map((b) => ({ ...b, text: 'Updated extraction' }))
  });

  assert.notEqual(first, second);
  assert.equal(documentOf(f.store, fetched.id)?.id, second);
  assert.equal(
    f.store.db.orm.select().from(s.documents).where(eq(s.documents.id, first)).get()?.id,
    first
  );
  const payloads = f.store.db.orm.select().from(s.material_document_versions).all();

  assert.deepEqual(
    payloads.map((p) => p.document_id),
    [first, second]
  );

  for (const payload of payloads)
    assert.equal(
      f.store.db.orm
        .select()
        .from(s.material_version_inputs)
        .where(eq(s.material_version_inputs.version_id, payload.version_id))
        .all().length,
      1
    );
});
