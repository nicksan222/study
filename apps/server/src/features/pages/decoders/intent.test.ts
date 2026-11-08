/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies durable receipt digests across renamed page operation inputs.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Protects historical intent hashes and canonical user content keys.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Pure digest regressions exercise typed codecs without database or provider access.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { intentHash } from './intent.ts';

testStable('page intents retain persisted receipt digests across renamed identities', () => {
  const schema = Schema.Struct({
    pageId: Schema.BigInt,
    noteId: Schema.BigInt,
    additionalNoteIds: Schema.Array(Schema.BigInt),
    input: Schema.Struct({ kind: Schema.Literal('page'), versionId: Schema.BigInt }),
    document: Schema.Struct({ text: Schema.String })
  });
  const historical = {
    additionalSessionIds: ['9'],
    document: { text: 'A note about pages' },
    documentId: '3',
    input: { kind: 'document', versionId: '5' },
    sessionId: '7'
  };
  const expected = createHash('sha256').update(JSON.stringify(historical)).digest('hex');

  expect(
    intentHash(schema, {
      pageId: 3n,
      noteId: 7n,
      additionalNoteIds: [9n],
      input: { kind: 'page', versionId: 5n },
      document: { text: 'A note about pages' }
    })
  ).toBe(expected);
});

testStable('historical intent encoding preserves annotation notes and canonical body keys', () => {
  const document = {
    blocks: [],
    meta: { footnote: 'original', note: 'annotation', pageId: 'metadata', noteId: 'metadata owner' }
  };
  const schema = Schema.Struct({
    pageId: Schema.BigInt,
    note: Schema.String,
    notes: Schema.Array(Schema.String),
    document: Schema.Json,
    input: Schema.Struct({ kind: Schema.Literal('page'), versionId: Schema.BigInt })
  });
  const historical = {
    document: {
      blocks: [],
      meta: {
        footnote: 'original',
        note: 'annotation',
        noteId: 'metadata owner',
        pageId: 'metadata'
      }
    },
    documentId: '3',
    input: { kind: 'document', versionId: '5' },
    note: 'An existing annotation',
    notes: ['An existing report note']
  };

  expect(
    intentHash(schema, {
      pageId: 3n,
      note: historical.note,
      notes: historical.notes,
      document,
      input: { kind: 'page', versionId: 5n }
    })
  ).toBe(createHash('sha256').update(JSON.stringify(historical)).digest('hex'));
});
