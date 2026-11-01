/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises structural and authorization failures using deterministic captured       │
 * │ fixtures.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies text ranges never authorize surrounding images or evidence.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Fixtures validate contracts and scope without claiming model factual correctness.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runSelectionContextSchema } from '@study/contracts/conversations/context';
import { sourceIdSchema } from '@study/contracts/ids';
import {
  materialGenerationInputSchema,
  materialGenerationPublicationSchema
} from '@study/contracts/materials/schemas';
import { createBlock } from '@study/contracts/sources/document';
import { Schema } from 'effect';

import { authorizedTransformAssets, validateDocumentTransform } from './document-transform.ts';

const paragraph = (text: string) =>
  createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] });
const meta = {
  extractor: null,
  extractorVersion: 1,
  provider: null,
  durationMs: null,
  pageCount: null,
  refiners: [],
  waitingFor: [],
  corrected: false,
  omissions: []
};

function fixture() {
  const image = createBlock({
    type: 'image',
    sourceId: Schema.decodeUnknownSync(sourceIdSchema)(1n),
    revision: 1,
    alt: 'alpha image'
  });
  const context = Schema.decodeUnknownSync(runSelectionContextSchema)({
    requestId: 'capture',
    sessionId: 1n,
    intentKey: 'intent',
    instruction: 'Preserve uncertainty',
    preferences: {},
    selectionRevision: 1n,
    messages: [],
    excludedMessages: 0,
    inputs: [
      {
        versionId: 1n,
        documentId: 1n,
        materialId: 1n,
        name: 'Original',
        scope: { kind: 'blocks', blockIds: [image.id] },
        excerpts: [
          {
            blockId: image.id,
            blockOrdinal: 0,
            start: 0,
            end: 11,
            text: 'alpha image',
            anchor: { type: 'authored' },
            content: image.content
          }
        ]
      }
    ]
  });
  const output = paragraph('alpha [1]');
  const publication = Schema.decodeUnknownSync(materialGenerationPublicationSchema)({
    requestId: 'document/capture',
    content: { kind: 'document', blocks: [output], meta },
    citations: [{ marker: 1n, inputVersionId: 1n, blockOrdinal: 0, quote: 'alpha' }],
    report: {
      notes: [
        { kind: 'uncertainty', explanation: 'Not independently verified', blockIds: [output.id] }
      ]
    }
  });
  return { context, publication, image, output };
}

test('managed images require captured structured authorization; an alt-text range grants only text', () => {
  const { context, publication, image } = fixture();
  assert.equal(authorizedTransformAssets(context).length, 1);
  const copied = createBlock(image.content);
  const withImage = {
    ...publication,
    content: { kind: 'document' as const, blocks: [copied, paragraph('alpha [1]')], meta },
    report: {
      notes: [{ kind: 'limit' as const, explanation: 'No external verification', blockIds: [] }]
    }
  };
  validateDocumentTransform(context, withImage);
  const range = Schema.decodeUnknownSync(runSelectionContextSchema)({
    ...context,
    inputs: context.inputs.map((input) => ({
      ...input,
      scope: {
        kind: 'ranges',
        ranges: [
          {
            versionId: input.versionId,
            documentId: input.documentId,
            blockId: image.id,
            start: 0,
            end: 5
          }
        ]
      },
      excerpts: input.excerpts.map((excerpt) => ({
        ...excerpt,
        end: 5,
        text: 'alpha',
        content: undefined
      }))
    }))
  });
  assert.equal(authorizedTransformAssets(range).length, 0);
  assert.throws(() => validateDocumentTransform(range, withImage));
  assert.throws(() =>
    validateDocumentTransform(context, {
      ...withImage,
      content: {
        ...withImage.content,
        blocks: [
          createBlock({
            type: 'image',
            sourceId: Schema.decodeUnknownSync(sourceIdSchema)(99n),
            revision: 1,
            alt: 'fake'
          })
        ]
      }
    })
  );
  assert.throws(() =>
    validateDocumentTransform(context, {
      ...withImage,
      content: {
        ...withImage.content,
        blocks: [
          createBlock({
            type: 'image',
            sourceId: Schema.decodeUnknownSync(sourceIdSchema)(1n),
            revision: 999,
            alt: 'fake revision'
          })
        ]
      }
    })
  );
  assert.throws(() =>
    validateDocumentTransform(range, {
      ...publication,
      citations: [{ ...publication.citations[0]!, quote: 'image' }]
    })
  );
});

test('empty, malformed, reused identity, fabricated source anchor and unscoped citations reject', () => {
  const { context, publication, image, output } = fixture();
  validateDocumentTransform(context, publication);
  for (const blocks of [
    [],
    [paragraph('')],
    [{ ...output, id: image.id }],
    [{ ...output, text: 'mismatched projection' }],
    [{ ...output, anchor: { type: 'page', page: 1 } }]
  ]) {
    assert.throws(() =>
      validateDocumentTransform(
        context,
        Schema.decodeUnknownSync(materialGenerationPublicationSchema)({
          ...publication,
          content: { kind: 'document', blocks, meta }
        })
      )
    );
  }
  assert.throws(() => validateDocumentTransform(context, { ...publication, citations: [] }));
  assert.throws(() => validateDocumentTransform(context, { ...publication, report: undefined }));
  assert.throws(() =>
    validateDocumentTransform(context, {
      ...publication,
      report: { notes: [{ kind: 'limit', explanation: 'Unknown block', blockIds: [image.id] }] }
    })
  );
});

test('collection generation still requires a project and Document generation requires explicit captured session scope', () => {
  const decode = Schema.decodeUnknownSync(materialGenerationInputSchema);
  assert.throws(() => decode({ title: 'Cards', kind: 'flashcards', inputVersionIds: [1n] }));
  assert.throws(() =>
    decode({ title: 'Doc', kind: 'document', inputVersionIds: [1n], projectId: 1n })
  );
  assert.throws(() =>
    decode({
      title: 'Doc',
      kind: 'document',
      inputVersionIds: [],
      documentTransform: { contextRequestId: 'capture', operations: ['clarity', 'clarity'] }
    })
  );
  assert.equal(
    decode({
      title: 'Doc',
      kind: 'document',
      inputVersionIds: [],
      documentTransform: {
        contextRequestId: 'capture',
        operations: [
          'clarity',
          'grammar',
          'structure',
          'combine',
          'deduplicate',
          'summarize',
          'explain',
          'expand',
          'translate',
          'factual_correction'
        ]
      }
    }).projectId,
    undefined
  );
});
