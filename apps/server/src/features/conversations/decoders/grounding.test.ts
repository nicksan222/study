import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DocumentId, SourceId } from '@study/contracts/ids';

import { createEvidenceCatalog } from '#server/platform/ai/evidence';

test('citations only resolve excerpts exposed by search', () => {
  const catalog = createEvidenceCatalog([
    {
      key: '1:2',
      reference: { sourceId: 1n as SourceId, documentId: 2n as DocumentId },
      name: 'Notes',
      blocks: [{ text: 'alpha beta' }, { text: 'gamma' }]
    }
  ]);

  assert.throws(() => catalog.citations('Answer [1]'));
  assert.equal(catalog.search('alpha')[0]?.text, '[1] alpha beta');
  assert.deepEqual(catalog.citations('Answer [1]'), [
    { marker: 1, reference: { sourceId: 1n, documentId: 2n }, blockOrdinal: 0, quote: 'alpha beta' }
  ]);
  assert.throws(() => catalog.citations('Answer [2]'));
  assert.deepEqual(catalog.citations('Plain answer'), []);
});

test('bounds excerpts and deduplicates captured documents', () => {
  const catalog = createEvidenceCatalog([]);
  const document = {
    key: '1:2',
    reference: { sourceId: 1n as SourceId, documentId: 2n as DocumentId },
    name: 'Notes',
    blocks: Array.from({ length: 250 }, () => ({ text: 'a'.repeat(2000) }))
  };

  catalog.addDocument(document);
  catalog.addDocument(document);
  const hits = catalog.search('a');

  assert.equal(hits.length, 10);
  assert.equal(hits[0]!.text.length, 1004);
  assert.throws(() => catalog.citations('Answer [101]'));
});

test('shared catalog preserves opaque material references', async () => {
  const { createEvidenceCatalog: createSharedCatalog } =
    await import('#server/platform/ai/evidence');
  const catalog = createSharedCatalog([
    {
      key: 'version',
      name: 'Notes',
      reference: { inputVersionId: 9n },
      blocks: [{ text: 'captured evidence' }]
    }
  ]);

  assert.throws(() => catalog.citations('[1]'));
  catalog.search('captured');
  assert.deepEqual(catalog.citations('[1]'), [
    { marker: 1, reference: { inputVersionId: 9n }, blockOrdinal: 0, quote: 'captured evidence' }
  ]);
});
