import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';
import { Schema } from 'effect';

import { contentRangeSchema } from '../src/inputs.ts';
import { createBlock, validBlockTextRange } from '../src/sources/document.ts';
import { anchorSchema } from '../src/sources/schemas.ts';

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
      assert.equal(validBlockTextRange(document, { ...range, start, end }), true);
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
      assert.equal(validBlockTextRange(document, { ...range, start, end }), false);
    }

    assert.equal(Schema.is(contentRangeSchema)({ ...range, start: 0.5 }), false);
    assert.equal(
      Schema.is(contentRangeSchema)({ ...range, end: Number.MAX_SAFE_INTEGER + 1 }),
      false
    );
    assert.equal(Schema.is(contentRangeSchema)({ ...range, start: 3, end: 1 }), false);
    assert.deepEqual(block.anchor, {
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

    for (const anchor of valid) assert.equal(Schema.is(anchorSchema)(anchor), true);

    for (const anchor of invalid) assert.equal(Schema.is(anchorSchema)(anchor), false);
  }
);
