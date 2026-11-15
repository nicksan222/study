import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import fc from 'fast-check';
import { assert, expect } from 'vite-plus/test';

import { contentRangeSchema } from '../src/inputs.ts';
import {
  createBlock,
  validBlockTextRange,
  encodeBlockContent,
  decodeBlockContent
} from '../src/sources/document.ts';
import type { BlockContent, Inline } from '../src/sources/schemas.ts';
import { canonicalText, anchorSchema } from '../src/sources/schemas.ts';

testStable(
  'editor ranges use exact UTF-16 boundaries independently of source byte positions',
  () => {
    const block = createBlock(
      { type: 'paragraph', inlines: [{ type: 'text', text: 'é😀e\u0301', marks: [] }] },
      { type: 'text', lineStart: 1, lineEnd: 1, start: 100, end: 109 }
    );
    const document = {
      blocks: [block],
      meta: {
        extractor: null,
        extractorVersion: 1,
        provider: null,
        durationMs: null,
        pageCount: null,
        refiners: [],
        waitingFor: [],
        corrected: false,
        omissions: []
      }
    };
    const range = { blockId: block.id, start: 0, end: 5 };

    for (const [start, end] of [
      [0, 0],
      [0, 1],
      [1, 3],
      [3, 5],
      [4, 5],
      [5, 5]
    ]) {
      assert.strictEqual(validBlockTextRange(document, { ...range, start, end }), true);
    }

    for (const [start, end] of [
      [0, 2],
      [2, 3],
      [2, 2],
      [-1, 1],
      [3, 1],
      [0, 6],
      [0.5, 1],
      [0, Number.NaN],
      [0, Number.POSITIVE_INFINITY],
      [100, 109]
    ]) {
      assert.strictEqual(validBlockTextRange(document, { ...range, start, end }), false);
    }

    assert.strictEqual(Schema.is(contentRangeSchema)({ ...range, start: 0.5 }), false);
    assert.strictEqual(
      Schema.is(contentRangeSchema)({ ...range, end: Number.MAX_SAFE_INTEGER + 1 }),
      false
    );
    assert.strictEqual(Schema.is(contentRangeSchema)({ ...range, start: 3, end: 1 }), false);
    expect(block.anchor).toStrictEqual({
      type: 'text',
      lineStart: 1,
      lineEnd: 1,
      start: 100,
      end: 109
    });
  }
);

testStable(
  'source anchors reject nonfinite, unsafe, reversed and unsupported locations centrally',
  () => {
    const valid = [
      { type: 'authored' },
      { type: 'page', page: 1 },
      { type: 'time', startMs: 0, endMs: 0 },
      { type: 'text', lineStart: 0, lineEnd: 1, start: 0, end: 9 },
      { type: 'url', url: 'https://example.test/source', fragment: null }
    ];
    const invalid = [
      { type: 'page', page: 0 },
      { type: 'page', page: 1.5 },
      { type: 'page', page: Number.POSITIVE_INFINITY },
      { type: 'slide', index: -1 },
      { type: 'paragraph', index: Number.NaN },
      { type: 'time', startMs: 2, endMs: 1 },
      { type: 'time', startMs: 0, endMs: Number.MAX_SAFE_INTEGER + 1 },
      { type: 'text', lineStart: 2, lineEnd: 1, start: 0, end: 9 },
      { type: 'text', lineStart: 1, lineEnd: 1, start: 9, end: 8 },
      { type: 'url', url: 'file:///tmp/private', fragment: null },
      { type: 'url', url: 'javascript:alert(1)', fragment: null }
    ];

    for (const anchor of valid) assert.strictEqual(Schema.is(anchorSchema)(anchor), true);

    for (const anchor of invalid) assert.strictEqual(Schema.is(anchorSchema)(anchor), false);
  }
);

testStable(
  'Unicode editor offsets agree with independently enumerated code point boundaries',
  () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', maxLength: 40 }),
        fc.nat(),
        fc.nat(),
        (text, a, b) => {
          const block = createBlock({
            type: 'paragraph',
            inlines: [{ type: 'text', text, marks: [] }]
          });
          const boundaries = new Set([0]);
          let offset = 0;

          for (const point of text) {
            offset += point.length;
            boundaries.add(offset);
          }

          const first = a % (text.length + 1);
          const second = b % (text.length + 1);
          const start = Math.min(first, second);
          const end = Math.max(first, second);

          expect(validBlockTextRange({ blocks: [block] }, { blockId: block.id, start, end })).toBe(
            boundaries.has(start) && boundaries.has(end)
          );
          const supplementary = createBlock({
            type: 'paragraph',
            inlines: [{ type: 'text', text: `${text}😀`, marks: [] }]
          });

          expect(
            validBlockTextRange(
              { blocks: [supplementary] },
              { blockId: supplementary.id, start: text.length + 1, end: text.length + 2 }
            )
          ).toBe(false);
        }
      ),
      { numRuns: 150 }
    );
  }
);

const arbitraryText = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 30 }),
  fc.string({ unit: 'binary', maxLength: 30 }),
  fc.constantFrom('e\u0301 👩🏽‍🔬', '\u0000\n\t"\\', '')
);

const marks = fc.array(fc.constantFrom('strong' as const, 'emphasis' as const, 'code' as const), {
  maxLength: 3
});

const inline: fc.Arbitrary<Inline> = fc.oneof(
  fc.record({ type: fc.constant('text' as const), text: arbitraryText, marks }),
  fc.record({
    type: fc.constant('link' as const),
    text: arbitraryText,
    href: fc.constantFrom('https://example.com/?q=a&b=c', '/note/1'),
    marks
  }),
  fc.record({ type: fc.constant('math' as const), text: arbitraryText }),
  fc.constant({ type: 'break' as const })
);

const inlines = fc.array(inline, { maxLength: 5 });

const content: fc.Arbitrary<BlockContent> = fc.oneof(
  fc.record({ type: fc.constantFrom('paragraph' as const, 'segment' as const), inlines }),
  fc.record({
    type: fc.constant('heading' as const),
    level: fc.integer({ min: 1, max: 6 }),
    inlines
  }),
  fc.record({
    type: fc.constant('code' as const),
    code: arbitraryText,
    language: fc.option(arbitraryText, { nil: null })
  }),
  fc.record({ type: fc.constant('math' as const), expression: arbitraryText }),
  fc.record({
    type: fc.constant('table' as const),
    rows: fc.array(
      fc.record({
        cells: fc.array(
          fc.record({ header: fc.boolean(), paragraphs: fc.array(inlines, { maxLength: 3 }) }),
          { maxLength: 3 }
        )
      }),
      { maxLength: 3 }
    )
  })
);

testStable('rich content JSON roundtrips preserve every inline and canonical projection', () => {
  fc.assert(
    fc.property(content, (original) => {
      const restored = decodeBlockContent(encodeBlockContent(original));

      expect(restored).toEqual(original);
      expect(encodeBlockContent(restored)).toBe(encodeBlockContent(original));
      expect(canonicalText(restored)).toBe(canonicalText(original));
    }),
    { numRuns: 150 }
  );
});
