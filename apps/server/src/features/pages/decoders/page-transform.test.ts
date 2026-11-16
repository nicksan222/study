import { pageTransformOutputSchema } from '@study/contracts';
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
import { sourceIdSchema } from '@study/contracts';
import { materialGenerationInputSchema } from '@study/contracts';
import { runSelectionContextSchema } from '@study/contracts';
import { transformPublicationSchema, transformRequestSchema } from '@study/contracts';
import { createBlock } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { standardSchema } from '#server/platform/ai/schema';

import { authorizedTransformAssets, validatePageTransform } from './page-transform.ts';

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
    noteId: 1n,
    intentKey: 'intent',
    instruction: 'Preserve uncertainty',
    preferences: {},
    selectionRevision: 1n,
    messages: [],
    excludedMessages: 0,
    inputs: [
      {
        input: { kind: 'page', versionId: 1n },
        pageId: 1n,
        snapshotId: 1n,
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
  const publication = Schema.decodeUnknownSync(transformPublicationSchema)({
    requestId: 'document/capture',
    generationEventId: 'document/capture',
    document: { blocks: [output], meta },
    citations: [
      {
        marker: 1,
        input: { kind: 'page', versionId: 1n },
        anchor: { type: 'authored' },
        quote: 'alpha',
        target: { blockId: image.id, start: 0, end: 11 }
      }
    ],
    report: {
      notes: [
        { kind: 'uncertainty', explanation: 'Not independently verified', blockIds: [output.id] }
      ]
    }
  });

  return { context, publication, image, output };
}

test.stable(
  'managed images require captured structured authorization; an alt-text range grants only text',
  () => {
    const { context, publication, image } = fixture();

    test.assert.strictEqual(authorizedTransformAssets(context).length, 1);
    const copied = createBlock(image.content);
    const withImage = {
      ...publication,
      document: { blocks: [copied, paragraph('alpha [1]')], meta },
      report: {
        notes: [{ kind: 'limit' as const, explanation: 'No external verification', blockIds: [] }]
      }
    };

    validatePageTransform(context, withImage);
    const range = Schema.decodeUnknownSync(runSelectionContextSchema)({
      ...context,
      inputs: context.inputs.map((input) => ({
        ...input,
        scope: {
          kind: 'ranges',
          ranges: [
            {
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

    test.assert.strictEqual(authorizedTransformAssets(range).length, 0);
    test.assert.throws(() => validatePageTransform(range, withImage));
    test.assert.throws(() =>
      validatePageTransform(context, {
        ...withImage,
        document: {
          ...withImage.document,
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
    test.assert.throws(() =>
      validatePageTransform(context, {
        ...withImage,
        document: {
          ...withImage.document,
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
    test.assert.throws(() =>
      validatePageTransform(range, {
        ...publication,
        citations: [{ ...publication.citations[0]!, quote: 'image' }]
      })
    );
  }
);

test.stable(
  'empty, malformed, reused identity, fabricated source anchor and unscoped citations reject',
  () => {
    const { context, publication, image, output } = fixture();

    validatePageTransform(context, publication);

    for (const blocks of [
      [],
      [paragraph('')],
      [{ ...output, id: image.id }],
      [{ ...output, text: 'mismatched projection' }],
      [{ ...output, anchor: { type: 'page', page: 1 } }]
    ]) {
      test.assert.throws(() =>
        validatePageTransform(
          context,
          Schema.decodeUnknownSync(transformPublicationSchema)({
            ...publication,
            document: { blocks, meta }
          })
        )
      );
    }

    test.assert.throws(() => validatePageTransform(context, { ...publication, citations: [] }));
    test.assert.throws(() =>
      Schema.decodeUnknownSync(transformPublicationSchema)({ ...publication, report: undefined })
    );
    test.assert.throws(() =>
      validatePageTransform(context, {
        ...publication,
        report: { notes: [{ kind: 'limit', explanation: 'Unknown block', blockIds: [image.id] }] }
      })
    );
  }
);

test.stable(
  'learning generation requires a project while authored execution requires captured intent and unique operations',
  () => {
    const learning = Schema.decodeUnknownSync(materialGenerationInputSchema);
    const authored = Schema.decodeUnknownSync(transformRequestSchema);

    test.assert.throws(() =>
      learning({ title: 'Cards', kind: 'flashcards', inputVersionIds: [1n] })
    );
    test.assert.throws(() =>
      learning({ title: 'Doc', kind: 'document', inputVersionIds: [1n], projectId: 1n })
    );
    test.assert.throws(() =>
      authored({ title: 'Doc', contextRequestId: 'capture', operations: ['clarity', 'clarity'] })
    );
    const result = authored({
      title: 'Doc',
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
    });

    test.assert.ok(result.contextRequestId === 'capture');
  }
);

test.stable(
  'provider JSON accepts authorized image identifiers without native bigint values',
  async () => {
    const output = {
      blocks: [{ type: 'image', sourceId: '1', revision: 1, alt: 'alpha image' }],
      notes: [{ kind: 'limit', explanation: 'No external verification', blockOrdinals: [] }]
    };
    const result = await standardSchema(pageTransformOutputSchema)['~standard'].validate(
      JSON.parse(JSON.stringify(output))
    );

    test.assert.strictEqual(result.issues, undefined);
  }
);

test.stable('separator-only tables are not completed note-only Pages', () => {
  const { context, publication } = fixture();
  const table = createBlock({
    type: 'table',
    rows: [
      {
        cells: [
          { header: false, paragraphs: [[]] },
          { header: false, paragraphs: [[]] }
        ]
      }
    ]
  });

  test.assert.ok(table.text.trim());
  test.assert.throws(() =>
    validatePageTransform(
      { ...context, inputs: [] },
      {
        ...publication,
        citations: [],
        document: { blocks: [table], meta },
        report: { notes: [{ kind: 'limit', explanation: 'No evidence', blockIds: [] }] }
      }
    )
  );
});

test.stable(
  'report-only evidence markers and captured target locations obey the same scope barrier',
  () => {
    const { context, publication, output } = fixture();
    const note = {
      kind: 'correction_proposal' as const,
      explanation: 'Proposal [1]',
      blockIds: [output.id]
    };

    validatePageTransform(context, { ...publication, report: { notes: [note] } });
    test.assert.throws(() =>
      validatePageTransform(context, {
        ...publication,
        report: { notes: [{ ...note, explanation: 'Fabricated evidence [2]' }] }
      })
    );
    test.assert.throws(() =>
      validatePageTransform(context, {
        ...publication,
        report: { notes: [note] },
        citations: [{ ...publication.citations[0]!, target: null }]
      })
    );
  }
);
