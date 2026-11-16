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

import { test } from '@study/testing';

import { createEvidenceCatalog, createPassageEvidenceCatalog } from './evidence.ts';

const captured = (key: string, blocks: readonly { text: string; blockOrdinal?: number }[]) => ({
  key,
  reference: { version: key },
  name: 'Captured evidence',
  blocks
});

function exhausted(run: () => unknown) {
  test.expect(run).toThrowError(test.expect.objectContaining({ kind: 'not_enough' }));
}

test.stable('evidence indexes blocks beyond the former count and character prefixes', () => {
  const blocks = Array.from({ length: 250 }, (_, index) => ({
    text: index === 249 ? 'finaltarget' : 'ordinary '.repeat(100),
    blockOrdinal: index + 17
  }));
  const document = captured('many', blocks);
  const catalog = createEvidenceCatalog([document]);
  const hit = catalog.search('finaltarget')[0]!;

  test.expect(catalog.citations(hit.text)).toStrictEqual([
    {
      marker: Number(hit.id),
      reference: document.reference,
      blockOrdinal: 266,
      quote: 'finaltarget'
    }
  ]);
});

test.stable('oversized blocks preserve exact original quotes, ordinals and references', () => {
  const text = `${'x'.repeat(999)}😀${'y'.repeat(102000)} finaltarget`;
  const document = { ...captured('large', [{ text, blockOrdinal: 41 }]), quoteLimit: 100000 };
  const catalog = createEvidenceCatalog([document]);
  const hit = catalog.search('finaltarget')[0]!;
  const citation = catalog.citations(hit.text)[0]!;

  test.assert.strictEqual(citation.reference, document.reference);
  test.assert.strictEqual(citation.blockOrdinal, 41);
  test.assert.ok(text.includes(citation.quote));
  test.assert.ok(citation.quote.length <= 1000);
  const first = catalog.search('xxx')[0]!;
  const firstQuote = catalog.citations(first.text)[0]!.quote;

  test.assert.strictEqual(firstQuote, text.slice(0, 999));
  test.assert.ok(!/[\uD800-\uDBFF]$/.test(firstQuote));
});

test.stable('failed admission leaves marker identity and duplicate-key state intact', () => {
  const catalog = createEvidenceCatalog([captured('first', [{ text: 'alpha' }])]);

  exhausted(() => catalog.addDocument(captured('later', [{ text: 'x'.repeat(1_000_001) }])));
  catalog.addDocument(captured('later', [{ text: 'beta' }]));
  catalog.addDocument(captured('first', [{ text: 'duplicate' }]));
  test.expect(catalog.search('beta').map((hit) => hit.id)).toStrictEqual(['2']);
  test.expect(catalog.search('alpha').map((hit) => hit.id)).toStrictEqual(['1']);
  test.expect(catalog.search('duplicate')).toStrictEqual([]);
  test.assert.strictEqual(catalog.citations('[1]')[0]!.quote, 'alpha');
});

test.stable('passage-count exhaustion and invalid quote bounds reject explicitly', () => {
  exhausted(() =>
    createEvidenceCatalog([
      captured(
        'many',
        Array.from({ length: 10001 }, () => ({ text: 'x' }))
      )
    ])
  );

  for (const quoteLimit of [0, -1, NaN, Infinity, 0.5]) {
    test
      .expect(() =>
        createEvidenceCatalog([{ ...captured('invalid', [{ text: 'alpha' }]), quoteLimit }])
      )
      .toThrowError(test.expect.objectContaining({ kind: 'invalid_input' }));
  }
});

test.stable('encoded search replies stay bounded and only emitted markers become citable', () => {
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

  test.assert.ok(hits.length > 0 && hits.length <= 10);
  test.assert.ok(new TextEncoder().encode(JSON.stringify(hits)).byteLength <= 32000);
  test.assert.strictEqual(
    catalog.citations(hits.map((hit) => hit.text).join('')).length,
    hits.length
  );
  test.assert.throws(() => catalog.citations(`[${hits.length + 1}]`));
  test.expect(catalog.search('')).toStrictEqual([]);
});

test.stable('requested smaller quote bounds preserve the whole admitted text', () => {
  const catalog = createEvidenceCatalog([
    { ...captured('small', [{ text: 'alpha beta gamma', blockOrdinal: 9 }]), quoteLimit: 6 }
  ]);
  const hits = catalog.search('amma');

  test.assert.strictEqual(hits.length, 1);
  test
    .expect(catalog.citations(hits[0]!.text))
    .toStrictEqual([
      { marker: 3, reference: { version: 'small' }, blockOrdinal: 9, quote: 'amma' }
    ]);
});

test.stable(
  'explicit passage catalogs preserve sparse original marker identity and ranking',
  () => {
    const reference = { version: 'original', range: { start: 12, end: 17 } };
    const catalog = createPassageEvidenceCatalog([
      { marker: 400, reference, blockOrdinal: 27, name: 'Original', quote: 'Alpha beta' },
      { marker: 7, reference, blockOrdinal: 31, name: 'Original', quote: 'alpha BETA' }
    ]);

    test.assert.throws(() => catalog.citations('[400]'));
    test.expect(catalog.search('alpha beta').map((hit) => hit.id)).toStrictEqual(['7', '400']);
    test
      .expect(catalog.citations('[400] [400]'))
      .toStrictEqual([{ marker: 400, reference, blockOrdinal: 27, quote: 'Alpha beta' }]);
    test.assert.strictEqual(catalog.citations('[400]')[0]!.reference, reference);
    test.assert.throws(() => catalog.citations('[1]'));
  }
);

test.stable('initial passage exposure is explicit and never authorizes omitted markers', () => {
  const passage = {
    marker: 99,
    reference: 'captured',
    blockOrdinal: 3,
    name: 'Original',
    quote: 'alpha'
  };
  const catalog = createPassageEvidenceCatalog([passage], { initiallyExposed: true });

  test.assert.strictEqual(catalog.citations('[99]')[0]!.quote, 'alpha');
  test.assert.throws(() => catalog.citations('[98]'));
  test.assert.throws(() => createPassageEvidenceCatalog([passage]).citations('[99]'));
  const empty = createPassageEvidenceCatalog([]);

  test.expect(empty.search('alpha')).toStrictEqual([]);
  test.expect(empty.citations('answer')).toStrictEqual([]);
  test.assert.throws(() => empty.citations('[99]'));
});

test.stable(
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
      test
        .expect(() => createPassageEvidenceCatalog([{ ...passage, marker }]))
        .toThrowError(test.expect.objectContaining({ kind: 'invalid_input' }));
    }

    test
      .expect(() => createPassageEvidenceCatalog([passage, passage]))
      .toThrowError(test.expect.objectContaining({ kind: 'invalid_input' }));

    for (const invalid of [
      { ...passage, quote: 'x'.repeat(1001) },
      { ...passage, name: 'x'.repeat(201) },
      { ...passage, blockOrdinal: -1 }
    ]) {
      test
        .expect(() => createPassageEvidenceCatalog([invalid]))
        .toThrowError(test.expect.objectContaining({ kind: 'invalid_input' }));
    }

    const largest = createPassageEvidenceCatalog([{ ...passage, marker: 4294967295 }]);

    test.assert.strictEqual(largest.search('alpha')[0]!.id, '4294967295');
    test.assert.strictEqual(largest.citations('[4294967295]')[0]!.marker, 4294967295);
  }
);

test.stable('explicit catalogs enforce whole-corpus bounds and bounded search exposure', () => {
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

  test.assert.ok(hits.length > 0 && hits.length <= 10);
  test.assert.ok(new TextEncoder().encode(JSON.stringify(hits)).byteLength <= 32000);
  test.assert.throws(() => catalog.citations(`[${(hits.length + 1) * 100}]`));
});

test.stable('passage admission captures marker and quote values before caller mutation', () => {
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
  test
    .expect(catalog.citations('[99]'))
    .toStrictEqual([{ marker: 99, reference: 'captured', blockOrdinal: 3, quote: 'alpha' }]);
  test.assert.strictEqual(catalog.search('alpha')[0]!.id, '99');
  test.assert.throws(() => catalog.citations('[100]'));
});
