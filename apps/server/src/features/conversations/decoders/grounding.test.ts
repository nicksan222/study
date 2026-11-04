/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks that citations resolve only searched excerpts, evidence is bounded and      │
 * │ deduplicated, opaque material references survive catalog sharing, and ranking handles    │
 * │ case-insensitive matches, ties, and empty queries.                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Builds evidence catalogs directly to check citation grounding and stable ranking.      │
 * │ - Covers malformed and boundary values without invoking provider behavior.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite exercises the shared evidence catalog directly, without database fixtures or   │
 * │ provider requests.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { ContentSnapshotId, SourceId } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { createEvidenceCatalog } from '#server/platform/ai/evidence';

testStable('citations only resolve excerpts exposed by search', () => {
  const catalog = createEvidenceCatalog([
    {
      key: '1:2',
      reference: { sourceId: 1n as SourceId, documentId: 2n as ContentSnapshotId },
      name: 'Notes',
      blocks: [{ text: 'alpha beta' }, { text: 'gamma' }]
    }
  ]);

  assert.throws(() => catalog.citations('Answer [1]'));
  assert.ok(catalog.search('alpha')[0]?.text === '[1] alpha beta');
  expect(catalog.citations('Answer [1]')).toStrictEqual([
    {
      marker: 1,
      reference: { sourceId: 1n, documentId: 2n },
      blockOrdinal: 0,
      quote: 'alpha beta'
    }
  ]);
  assert.throws(() => catalog.citations('Answer [2]'));
  expect(catalog.citations('Plain answer')).toStrictEqual([]);
});

testStable('bounds excerpts and deduplicates captured documents', () => {
  const catalog = createEvidenceCatalog([]);
  const document = {
    key: '1:2',
    reference: { sourceId: 1n as SourceId, documentId: 2n as ContentSnapshotId },
    name: 'Notes',
    blocks: Array.from({ length: 250 }, () => ({ text: 'a'.repeat(2000) }))
  };

  catalog.addDocument(document);
  catalog.addDocument(document);
  const hits = catalog.search('a');

  assert.strictEqual(hits.length, 10);
  assert.strictEqual(hits[0]!.text.length, 1004);
  assert.throws(() => catalog.citations('Answer [101]'));
});

testStable('shared catalog preserves opaque material references', async () => {
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
  expect(catalog.citations('[1]')).toStrictEqual([
    { marker: 1, reference: { inputVersionId: 9n }, blockOrdinal: 0, quote: 'captured evidence' }
  ]);
});

testStable(
  'evidence ranking preserves case-insensitive scores, marker ties and empty queries',
  () => {
    const catalog = createEvidenceCatalog([
      {
        key: 'ranking',
        reference: 'version',
        name: 'Notes',
        blocks: [{ text: 'ALPHA' }, { text: 'beta alpha' }, { text: 'Alpha beta' }]
      }
    ]);

    expect(catalog.search('  ')).toStrictEqual([]);
    assert.throws(() => catalog.citations('[2]'));
    expect(catalog.search(' alpha BETA ').map((hit) => hit.id)).toStrictEqual(['2', '3', '1']);
    expect(catalog.citations('[2]')).toStrictEqual([
      { marker: 2, reference: 'version', blockOrdinal: 1, quote: 'beta alpha' }
    ]);
  }
);
