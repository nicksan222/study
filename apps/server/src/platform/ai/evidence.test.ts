/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tests complete admission and bounded exposure of captured selected evidence.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies original references, passage bounds, stable markers and atomic admission.     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Pure catalog tests use captured text without providers, documents or persistence.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { createEvidenceCatalog, createPassageEvidenceCatalog } from './evidence.ts';

const captured = (key: string, blocks: readonly { text: string; blockOrdinal?: number }[]) => ({
  key,
  reference: { version: key },
  name: 'Captured evidence',
  blocks
});

function exhausted(run: () => unknown) {
  expect(run).toThrowError(expect.objectContaining({ kind: 'not_enough' }));
}

testStable('evidence indexes blocks beyond the former count and character prefixes', () => {
  const blocks = Array.from({ length: 250 }, (_, index) => ({
    text: index === 249 ? 'finaltarget' : 'ordinary '.repeat(100),
    blockOrdinal: index + 17
  }));
  const document = captured('many', blocks);
  const catalog = createEvidenceCatalog([document]);
  const hit = catalog.search('finaltarget')[0]!;

  expect(catalog.citations(hit.text)).toStrictEqual([
    {
      marker: Number(hit.id),
      reference: document.reference,
      blockOrdinal: 266,
      quote: 'finaltarget'
    }
  ]);
});

testStable('oversized blocks preserve exact original quotes, ordinals and references', () => {
  const text = `${'x'.repeat(999)}😀${'y'.repeat(102000)} finaltarget`;
  const document = { ...captured('large', [{ text, blockOrdinal: 41 }]), quoteLimit: 100000 };
  const catalog = createEvidenceCatalog([document]);
  const hit = catalog.search('finaltarget')[0]!;
  const citation = catalog.citations(hit.text)[0]!;

  assert.strictEqual(citation.reference, document.reference);
  assert.strictEqual(citation.blockOrdinal, 41);
  assert.ok(text.includes(citation.quote));
  assert.ok(citation.quote.length <= 1000);
  const first = catalog.search('xxx')[0]!;
  const firstQuote = catalog.citations(first.text)[0]!.quote;

  assert.strictEqual(firstQuote, text.slice(0, 999));
  assert.ok(!/[\uD800-\uDBFF]$/.test(firstQuote));
});

testStable('failed admission leaves marker identity and duplicate-key state intact', () => {
  const catalog = createEvidenceCatalog([captured('first', [{ text: 'alpha' }])]);

  exhausted(() => catalog.addDocument(captured('later', [{ text: 'x'.repeat(1_000_001) }])));
  catalog.addDocument(captured('later', [{ text: 'beta' }]));
  catalog.addDocument(captured('first', [{ text: 'duplicate' }]));
  expect(catalog.search('beta').map((hit) => hit.id)).toStrictEqual(['2']);
  expect(catalog.search('alpha').map((hit) => hit.id)).toStrictEqual(['1']);
  expect(catalog.search('duplicate')).toStrictEqual([]);
  assert.strictEqual(catalog.citations('[1]')[0]!.quote, 'alpha');
});

testStable('passage-count exhaustion and invalid quote bounds reject explicitly', () => {
  exhausted(() =>
    createEvidenceCatalog([
      captured(
        'many',
        Array.from({ length: 10001 }, () => ({ text: 'x' }))
      )
    ])
  );

  for (const quoteLimit of [0, -1, NaN, Infinity, 0.5]) {
    expect(() =>
      createEvidenceCatalog([{ ...captured('invalid', [{ text: 'alpha' }]), quoteLimit }])
    ).toThrowError(expect.objectContaining({ kind: 'invalid_input' }));
  }
});

testStable('encoded search replies stay bounded and only emitted markers become citable', () => {
  const catalog = createEvidenceCatalog([
    {
      ...captured(
        'encoded',
        Array.from({ length: 20 }, () => ({ text: `needle${'\u0001'.repeat(994)}` }))
      ),
      name: '\u0001'.repeat(200)
    }
  ]);
  const hits = catalog.search('needle');

  assert.ok(hits.length > 0 && hits.length <= 10);
  assert.ok(new TextEncoder().encode(JSON.stringify(hits)).byteLength <= 32000);
  assert.strictEqual(catalog.citations(hits.map((hit) => hit.text).join('')).length, hits.length);
  assert.throws(() => catalog.citations(`[${hits.length + 1}]`));
  expect(catalog.search('')).toStrictEqual([]);
});

testStable('requested smaller quote bounds preserve the whole admitted text', () => {
  const catalog = createEvidenceCatalog([
    { ...captured('small', [{ text: 'alpha beta gamma', blockOrdinal: 9 }]), quoteLimit: 6 }
  ]);
  const hits = catalog.search('amma');

  assert.strictEqual(hits.length, 1);
  expect(catalog.citations(hits[0]!.text)).toStrictEqual([
    { marker: 3, reference: { version: 'small' }, blockOrdinal: 9, quote: 'amma' }
  ]);
});

testStable('explicit passage catalogs preserve sparse original marker identity and ranking', () => {
  const reference = { version: 'original', range: { start: 12, end: 17 } };
  const catalog = createPassageEvidenceCatalog([
    { marker: 400, reference, blockOrdinal: 27, name: 'Original', quote: 'Alpha beta' },
    { marker: 7, reference, blockOrdinal: 31, name: 'Original', quote: 'alpha BETA' }
  ]);

  assert.throws(() => catalog.citations('[400]'));
  expect(catalog.search('alpha beta').map((hit) => hit.id)).toStrictEqual(['7', '400']);
  expect(catalog.citations('[400] [400]')).toStrictEqual([
    { marker: 400, reference, blockOrdinal: 27, quote: 'Alpha beta' }
  ]);
  assert.strictEqual(catalog.citations('[400]')[0]!.reference, reference);
  assert.throws(() => catalog.citations('[1]'));
});

testStable('initial passage exposure is explicit and never authorizes omitted markers', () => {
  const passage = {
    marker: 99,
    reference: 'captured',
    blockOrdinal: 3,
    name: 'Original',
    quote: 'alpha'
  };
  const catalog = createPassageEvidenceCatalog([passage], { initiallyExposed: true });

  assert.strictEqual(catalog.citations('[99]')[0]!.quote, 'alpha');
  assert.throws(() => catalog.citations('[98]'));
  assert.throws(() => createPassageEvidenceCatalog([passage]).citations('[99]'));
  const empty = createPassageEvidenceCatalog([]);

  expect(empty.search('alpha')).toStrictEqual([]);
  expect(empty.citations('answer')).toStrictEqual([]);
  assert.throws(() => empty.citations('[99]'));
});

testStable(
  'explicit passage admission rejects invalid markers, passage bounds and duplicate identities',
  () => {
    const passage = {
      marker: 1,
      reference: 'captured',
      blockOrdinal: 0,
      name: 'Original',
      quote: 'alpha'
    };

    for (const marker of [0, -1, 1.5, NaN, Infinity, 4294967296]) {
      expect(() => createPassageEvidenceCatalog([{ ...passage, marker }])).toThrowError(
        expect.objectContaining({ kind: 'invalid_input' })
      );
    }

    expect(() => createPassageEvidenceCatalog([passage, passage])).toThrowError(
      expect.objectContaining({ kind: 'invalid_input' })
    );

    for (const invalid of [
      { ...passage, quote: 'x'.repeat(1001) },
      { ...passage, name: 'x'.repeat(201) },
      { ...passage, blockOrdinal: -1 }
    ]) {
      expect(() => createPassageEvidenceCatalog([invalid])).toThrowError(
        expect.objectContaining({ kind: 'invalid_input' })
      );
    }

    const largest = createPassageEvidenceCatalog([{ ...passage, marker: 4294967295 }]);

    assert.strictEqual(largest.search('alpha')[0]!.id, '4294967295');
    assert.strictEqual(largest.citations('[4294967295]')[0]!.marker, 4294967295);
  }
);

testStable('explicit catalogs enforce whole-corpus bounds and bounded search exposure', () => {
  const passage = {
    marker: 1,
    reference: 'captured',
    blockOrdinal: 0,
    name: '\u0001'.repeat(200),
    quote: `needle${'\u0001'.repeat(994)}`
  };

  exhausted(() =>
    createPassageEvidenceCatalog(
      Array.from({ length: 1001 }, (_, index) => ({ ...passage, marker: index + 1 }))
    )
  );
  exhausted(() =>
    createPassageEvidenceCatalog(
      Array.from({ length: 10001 }, (_, index) => ({ ...passage, marker: index + 1, quote: 'x' }))
    )
  );
  const catalog = createPassageEvidenceCatalog(
    Array.from({ length: 20 }, (_, index) => ({ ...passage, marker: (index + 1) * 100 }))
  );
  const hits = catalog.search('needle');

  assert.ok(hits.length > 0 && hits.length <= 10);
  assert.ok(new TextEncoder().encode(JSON.stringify(hits)).byteLength <= 32000);
  assert.throws(() => catalog.citations(`[${(hits.length + 1) * 100}]`));
});

testStable('passage admission captures marker and quote values before caller mutation', () => {
  const passage = {
    marker: 99,
    reference: 'captured',
    blockOrdinal: 3,
    name: 'Original',
    quote: 'alpha'
  };
  const catalog = createPassageEvidenceCatalog([passage], { initiallyExposed: true });

  passage.marker = 100;
  passage.quote = 'changed';
  expect(catalog.citations('[99]')).toStrictEqual([
    { marker: 99, reference: 'captured', blockOrdinal: 3, quote: 'alpha' }
  ]);
  assert.strictEqual(catalog.search('alpha')[0]!.id, '99');
  assert.throws(() => catalog.citations('[100]'));
});
