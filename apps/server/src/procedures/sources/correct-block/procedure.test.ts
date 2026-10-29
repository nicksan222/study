import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNote as dbCreateNote } from '#server/procedures/sources/operations/create-note';
import {
  saveDocument as dbSaveDocument,
  documentOf as dbDocumentOf
} from '#server/procedures/sources/operations/source-document';
import { document } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';
test('correctBlock updates the requested anchored block and reports missing targets', async (t) => {
  const f = await createServerTest(t);
  const source = dbCreateNote(f.store, 'n', 'old');
  const docId = dbSaveDocument(f.store, source.id, document);
  const changed = await f.caller.sources.correctBlock({
    id: source.id,
    documentId: docId,
    ordinal: 0,
    before: 'Gravity attracts masses',
    after: 'new'
  });

  assert.equal(changed.value, true);
  const missing = await f.caller.sources.correctBlock({
    id: source.id,
    documentId: docId,
    ordinal: 0,
    before: 'old',
    after: 'again'
  });

  assert.equal(missing.value, false);
  assert.equal(dbDocumentOf(f.store, source.id)?.document.blocks[0]?.text, 'new');
  const replacement = dbSaveDocument(f.store, source.id, structuredClone(document));

  assert.notEqual(replacement, docId);
  assert.equal(
    (
      await f.caller.sources.correctBlock({
        id: source.id,
        documentId: docId,
        ordinal: 0,
        before: 'Gravity attracts masses',
        after: 'stale'
      })
    ).value,
    false
  );
  assert.equal(
    dbDocumentOf(f.store, source.id)?.document.blocks[0]?.text,
    'Gravity attracts masses'
  );
  await assert.rejects(
    f.caller.sources.correctBlock({
      id: source.id,
      ordinal: 0
    } as never),
    {
      kind: 'invalid_input'
    }
  );
});
