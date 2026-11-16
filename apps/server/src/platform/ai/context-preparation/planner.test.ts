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

import { contentInputSchema } from '@study/contracts';
import type { Document } from '@study/contracts';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { planSourcePassages, splitTextRanges, sourcePassagePlanSchema } from './index.ts';
import type { SourcePlanLimits, SourceInput, SourceSelection } from './index.ts';
import { document } from './test-helpers.ts';

const limits: SourcePlanLimits = {
  maxPieceChars: 16000,
  maxPassageChars: 1000,
  maxPieceBytes: 100000,
  maxPlanChars: 1000000,
  maxPlanBytes: 3000000,
  maxPieces: 128
};

const completeSelection: SourceSelection = { mode: 'complete' };

const referenceSchema = Schema.Struct({ version: Schema.String });

function plan(input: Document, options?: Partial<typeof limits>) {
  return planSourcePassages({
    documents: [{ key: 'one', name: 'Original', reference: { version: 'exact' }, document: input }],
    referenceSchema,
    ...(options ? { limits: { ...limits, ...options } } : {}),
    selection: completeSelection
  });
}

test.unit.stable(
  'reconstructs more than 100k characters, 200 blocks and oversized Unicode blocks exactly',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

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

test.unit.stable(
  'rejects whole-plan exhaustion and invalid limits with canonical typed failures',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

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

test.unit.stable(
  'keeps explicit selected scope and rejects invalid or overlapping selections',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const input = document(['alpha 🌏 omega']);
    const block = input.blocks[0]!;
    const selected = (
      ranges: { documentKey: string; blockId: typeof block.id; start: number; end: number }[]
    ) =>
      planSourcePassages({
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

test.unit.stable(
  'bounds encoded bigint content references and preserves exact message references',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const contentReference = Schema.decodeUnknownSync(contentInputSchema)({
      kind: 'source',
      sourceId: 1n,
      revision: 2n,
      snapshotId: 3n
    });
    const input = document(['original 🌏 text']);
    const result = await Effect.runPromise(
      planSourcePassages({
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
      planSourcePassages({
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

test.unit.stable(
  'counts metadata for empty blocks and rejects duplicate document keys',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const input = document(Array.from({ length: 3000 }, () => ''));
    const failure = await Effect.runPromise(
      Effect.flip(plan(input, { maxPieceBytes: 1000, maxPieces: 2 }))
    );

    assert.equal(failure.kind, 'not_enough');
    const duplicate: SourceInput<{ version: string }> = {
      key: 'one',
      name: 'Original',
      reference: { version: 'exact' },
      document: document(['x'])
    };
    const duplicated = planSourcePassages({
      documents: [duplicate, duplicate],
      referenceSchema,
      limits,
      selection: { mode: 'complete' }
    });

    assert.equal((await Effect.runPromise(Effect.flip(duplicated))).kind, 'invalid_input');
  }
);

test.unit.stable(
  'bounds canonical Unicode ranges with no omitted characters',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

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
  }
);

test.unit.stable(
  'accepts feature reference codecs whose encoded and decoded shapes differ',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const transformedReferenceSchema = Schema.Struct({ revision: Schema.NumberFromString });
    const result = await Effect.runPromise(
      planSourcePassages({
        documents: [
          {
            key: 'one',
            name: 'Original',
            reference: { revision: 42 },
            document: document(['exact'])
          }
        ],
        referenceSchema: transformedReferenceSchema,
        limits,
        selection: { mode: 'complete' }
      })
    );

    assert.deepEqual(result.pieces[0]!.passages[0]!.reference, { revision: 42 });
  }
);

test.unit.stable(
  'validates persisted plan markers and encoded metadata bounds',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const original = await Effect.runPromise(plan(document(['original'])));
    const schema = sourcePassagePlanSchema(referenceSchema);
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
  }
);

test.unit.stable(
  'byte-budget search finds fitting prefixes after a surrogate pair',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const input = document(['🌏abc']);
    const original = await Effect.runPromise(plan(input, { maxPieceChars: 5, maxPassageChars: 5 }));
    const piece = original.pieces[0]!;
    const passage = piece.passages[0]!;
    const budget = new TextEncoder().encode(
      JSON.stringify({
        ...piece,
        passages: [{ ...passage, text: '🌏', end: 2 }]
      })
    ).byteLength;
    const result = await Effect.runPromise(
      plan(input, {
        maxPieceChars: 5,
        maxPassageChars: 5,
        maxPieceBytes: budget
      })
    );

    assert.deepEqual(
      result.pieces.flatMap((part) => part.passages.map((span) => span.text)),
      ['🌏', 'abc']
    );
  }
);
