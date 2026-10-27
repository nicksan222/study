import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture, document } from '#testing/procedures';

import { createNote as dbCreateNote } from './create-note.ts';
import {
  saveDocument as dbSaveDocument,
  document as readDocument,
  sourceOfDocument
} from './source-document.ts';
import { storeFetched } from './source.ts';
test('sourceDocument returns converted stored document or no value', async (t) => {
  const f = await fixture(t);
  const source = dbCreateNote(f.store, 'n', 'body');

  dbSaveDocument(f.store, source.id, document);
  const found = await f.caller.sources.sourceDocument({
    id: source.id
  });

  assert.equal(found.value?.blocks[0]?.text, document.blocks[0]?.text);
  assert.equal(
    (
      await f.caller.sources.sourceDocument({
        id: 999999n
      })
    ).value,
    null
  );
});

test('original links resolve the latest fetched document without changing document ownership', async (t) => {
  const f = await fixture(t);
  const project = await f.caller.projects.createProject({ name: 'Web' });
  const link = await f.caller.sources.addLink({
    project: project.id,
    url: 'https://example.com/article'
  });
  const fetchSnapshot = (text: string) => {
    const source = storeFetched(f.store, link.id, {
      name: 'Article',
      bytes: Buffer.from('<p>' + text + '</p>'),
      kind: 'web',
      mime: 'text/html',
      uri: link.uri
    })!;
    const doc = { ...document, blocks: document.blocks.map((block) => ({ ...block, text })) };

    return { source, id: dbSaveDocument(f.store, source.id, doc) };
  };

  assert.equal((await f.caller.sources.sourceDocument({ id: link.id })).value, null);
  const first = fetchSnapshot('First fetched content');
  const firstRead = (await f.caller.sources.sourceDocument({ id: link.id })).value;

  assert.equal(firstRead?.id, first.id);
  assert.equal(firstRead?.blocks[0]?.text, 'First fetched content');
  assert.equal(sourceOfDocument(f.store, first.id), first.source.id);

  const second = fetchSnapshot('Second fetched content');

  assert.equal((await f.caller.sources.sourceDocument({ id: link.id })).value?.id, second.id);
  assert.equal(
    (await f.caller.sources.sourceDocument({ id: link.id })).value?.blocks[0]?.text,
    'Second fetched content'
  );
  assert.equal(sourceOfDocument(f.store, second.id), second.source.id);
  assert.equal(readDocument(f.store, first.id)?.blocks[0]?.text, 'First fetched content');

  dbSaveDocument(f.store, first.source.id, {
    ...document,
    blocks: document.blocks.map((block) => ({ ...block, text: 'Later extraction of old snapshot' }))
  });
  assert.equal((await f.caller.sources.sourceDocument({ id: link.id })).value?.id, second.id);
});
