import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture, document } from '#testing/procedures';

import { createNote as dbCreateNote } from './create-note.ts';
import { saveDocument as dbSaveDocument } from './source-document.ts';
test('preview returns extracted document text, falling back to source text', async (t) => {
  const f = await fixture(t);
  const source = dbCreateNote(f.store, 'n', 'raw text');
  const extracted = {
    ...document,
    blocks: [
      {
        ...document.blocks[0]!,
        text: 'Extracted'
      }
    ]
  };

  dbSaveDocument(f.store, source.id, extracted);
  assert.deepEqual(
    await f.caller.sources.preview({
      id: source.id
    }),
    {
      type: 'text',
      text: 'Extracted'
    }
  );
  const plain = dbCreateNote(f.store, 'plain', 'raw only');

  assert.equal(
    (
      await f.caller.sources.preview({
        id: plain.id
      })
    ).type,
    'text'
  );
  await assert.rejects(
    f.caller.sources.preview({
      id: 999999n
    }),
    {
      kind: 'not_found'
    }
  );
});
