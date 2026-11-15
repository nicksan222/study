/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies exact bounded document views preserve original canonical input identity.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises complete reconstruction, Unicode safety and explicit selected scope.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use canonical documents without provider calls or substitute checkpoint            │
 * │ persistence.                                                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { contentInputSchema } from '@study/contracts/inputs';
import type { Document } from '@study/contracts/sources/document';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { planDocumentPieces, splitTextRanges, documentPiecePlanSchema } from './index.ts';
import type { DocumentPlanLimits, DocumentInput, DocumentSelection } from './index.ts';
import { document } from './test-helpers.ts';

const limits: DocumentPlanLimits = {
  maxPieceChars: 16000,
  maxPassageChars: 1000,
  maxPieceBytes: 100000,
  maxPlanChars: 1000000,
  maxPlanBytes: 3000000,
  maxPieces: 128
};

const completeSelection: DocumentSelection = { mode: 'complete' };

const referenceSchema = Schema.Struct({ version: Schema.String });

function plan(input: Document, options: Partial<typeof limits> = {}) {
  return planDocumentPieces({
    documents: [{ key: 'one', name: 'Original', reference: { version: 'exact' }, document: input }],
    referenceSchema,
    limits: { ...limits, ...options },
    selection: completeSelection
  });
}

testStable(
  'reconstructs more than 100k characters, 200 blocks and oversized Unicode blocks exactly',
  async () => {
    const input = document([
      ...Array.from({ length: 240 }, (_, i) => `${i} evidence\n`),
      '🌏a'.repeat(60000)
    ]);
    const result = await Effect.runPromise(plan(input));
    const passages = result.pieces.flatMap((piece) => piece.passages);

    assert.equal(new Set(passages.map((p) => p.marker)).size, passages.length);

    for (const [ordinal, block] of input.blocks.entries()) {
      const parts = passages.filter((p) => p.blockId === block.id);

      assert.equal(parts.map((p) => p.text).join(''), block.text);

      for (const part of parts) {
        assert.equal(part.ordinal, ordinal);
        assert.equal(part.text, block.text.slice(part.start, part.end));
        assert.deepEqual(part.anchor, block.anchor);
        assert.deepEqual(part.reference, { version: 'exact' });
        assert.isFalse(/[\uD800-\uDBFF]$/.test(part.text));
      }
    }

    assert.deepEqual(await Effect.runPromise(plan(input)), result);
  }
);

testStable(
  'rejects whole-plan exhaustion and invalid limits with canonical typed failures',
  async () => {
    assert.equal(
      (await Effect.runPromise(Effect.flip(plan(document(['abc']), { maxPlanChars: 2 })))).kind,
      'not_enough'
    );
    assert.equal(
      (await Effect.runPromise(Effect.flip(plan(document(['abc']), { maxPieceChars: 0 })))).kind,
      'invalid_input'
    );
  }
);

testStable(
  'keeps explicit selected scope and rejects invalid or overlapping selections',
  async () => {
    const input = document(['alpha 🌏 omega']);
    const block = input.blocks[0]!;
    const selected = (
      ranges: { documentKey: string; blockId: typeof block.id; start: number; end: number }[]
    ) =>
      planDocumentPieces({
        documents: [
          { key: 'one', name: 'Original', reference: { version: 'exact' }, document: input }
        ],
        referenceSchema,
        limits,
        selection: { mode: 'selected', ranges }
      });
    const range = { documentKey: 'one', blockId: block.id, start: 6, end: 8 };
    const result = await Effect.runPromise(selected([range]));

    assert.deepEqual(result.selection, { mode: 'selected', ranges: [range] });
    assert.equal(result.pieces[0]!.passages[0]!.text, '🌏');
    assert.equal(
      (await Effect.runPromise(Effect.flip(selected([{ ...range, end: 7 }])))).kind,
      'invalid_input'
    );
    assert.equal(
      (await Effect.runPromise(Effect.flip(selected([range, range])))).kind,
      'invalid_input'
    );
  }
);

testStable(
  'bounds encoded bigint content references and preserves exact message references',
  async () => {
    const contentReference = Schema.decodeUnknownSync(contentInputSchema)({
      kind: 'source',
      sourceId: 1n,
      revision: 2n,
      snapshotId: 3n
    });
    const input = document(['original 🌏 text']);
    const result = await Effect.runPromise(
      planDocumentPieces({
        documents: [
          { key: 'source', name: 'Source', reference: contentReference, document: input }
        ],
        referenceSchema: contentInputSchema,
        limits,
        selection: { mode: 'complete' }
      })
    );

    assert.deepEqual(result.pieces[0]!.passages[0]!.reference, contentReference);
    const messageSchema = Schema.Struct({
      kind: Schema.Literal('message'),
      messageId: Schema.BigInt,
      revision: Schema.BigInt
    });
    const exact = { kind: 'message' as const, messageId: 7n, revision: 12n };
    const selected = await Effect.runPromise(
      planDocumentPieces({
        documents: [
          { key: 'message:7:12', name: 'Conversation', reference: exact, document: input }
        ],
        referenceSchema: messageSchema,
        limits,
        selection: { mode: 'complete' }
      })
    );

    assert.deepEqual(selected.pieces[0]!.passages[0]!.reference, exact);
  }
);

testStable('counts metadata for empty blocks and rejects duplicate document keys', async () => {
  const input = document(Array.from({ length: 3000 }, () => ''));
  const failure = await Effect.runPromise(
    Effect.flip(plan(input, { maxPieceBytes: 1000, maxPieces: 2 }))
  );

  assert.equal(failure.kind, 'not_enough');
  const duplicate: DocumentInput<{ version: string }> = {
    key: 'one',
    name: 'Original',
    reference: { version: 'exact' },
    document: document(['x'])
  };
  const duplicated = planDocumentPieces({
    documents: [duplicate, duplicate],
    referenceSchema,
    limits,
    selection: { mode: 'complete' }
  });

  assert.equal((await Effect.runPromise(Effect.flip(duplicated))).kind, 'invalid_input');
});

testStable('bounds canonical Unicode ranges with no omitted characters', () => {
  const text = 'a🌏z🌏';
  const ranges = splitTextRanges(text, 2);

  assert.deepEqual(ranges, [
    { start: 0, end: 1 },
    { start: 1, end: 3 },
    { start: 3, end: 4 },
    { start: 4, end: 6 }
  ]);
  assert.equal(ranges.map((range) => text.slice(range.start, range.end)).join(''), text);
  assert.deepEqual(splitTextRanges('', 2), [{ start: 0, end: 0 }]);
});

testStable('accepts feature reference codecs whose encoded and decoded shapes differ', async () => {
  const transformedReferenceSchema = Schema.Struct({ revision: Schema.NumberFromString });
  const result = await Effect.runPromise(
    planDocumentPieces({
      documents: [
        { key: 'one', name: 'Original', reference: { revision: 42 }, document: document(['exact']) }
      ],
      referenceSchema: transformedReferenceSchema,
      limits,
      selection: { mode: 'complete' }
    })
  );

  assert.deepEqual(result.pieces[0]!.passages[0]!.reference, { revision: 42 });
});

testStable('validates persisted plan markers and encoded metadata bounds', async () => {
  const original = await Effect.runPromise(plan(document(['original'])));
  const schema = documentPiecePlanSchema(referenceSchema);
  const codec = Schema.toCodecJson(schema);

  assert.deepEqual(Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(original)), original);
  const piece = original.pieces[0]!;
  const passage = piece.passages[0]!;

  assert.throws(() =>
    Schema.decodeUnknownSync(schema)({
      ...original,
      pieces: [{ ...piece, passages: [{ ...passage, marker: 42 }] }]
    })
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(schema)({
      ...original,
      limits: { ...original.limits, maxPieceBytes: 1 }
    })
  );
});
