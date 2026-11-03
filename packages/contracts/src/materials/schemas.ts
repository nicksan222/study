import { Effect, Schema } from 'effect';

import {
  documentIdSchema,
  materialCardIdSchema,
  materialIdSchema,
  materialVersionIdSchema,
  projectIdSchema,
  quizQuestionIdSchema,
  quizChoiceIdSchema,
  sessionIdSchema,
  sourceIdSchema
} from '../ids.ts';
import {
  anchorSchema,
  blockIdSchema,
  documentSchema,
  documentTextRangeSchema,
  sourceSchema
} from '../sources/schemas.ts';
import { citationSupportSchema, evidenceResolutionSchema } from './evidence.ts';

export { materialIdSchema };

const nonemptySchema = Schema.Trim.check(Schema.isMinLength(1));

export const materialKindSchema = Schema.Literals([
  'file',
  'audio',
  'video',
  'image',
  'link',
  'document',
  'diagram',
  'quiz',
  'flashcards'
]);

export const materialGenerationKindSchema = Schema.Literals([
  'flashcards',
  'diagram',
  'quiz',
  'document'
]);

/** Session transforms create independent derivatives or retain explicit target proposals. */
export const documentTransformSchema = Schema.Struct({
  contextRequestId: Schema.String.check(Schema.isMinLength(1)),
  editTargetVersionId: Schema.optional(materialVersionIdSchema),
  operations: Schema.Array(
    Schema.Literals([
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
    ])
  ).check(Schema.isBetweenLength(1, 10))
}).check(Schema.makeFilter((value) => new Set(value.operations).size === value.operations.length));

export const documentTransformReportSchema = Schema.Struct({
  notes: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals([
        'addition',
        'omission',
        'conflict',
        'uncertainty',
        'correction_proposal',
        'limit'
      ]),
      explanation: Schema.Trim.check(Schema.isBetweenLength(1, 4000)),
      blockIds: Schema.Array(blockIdSchema).check(Schema.isMaxLength(200))
    })
  ).check(Schema.isBetweenLength(1, 200))
});

export const materialGenerationInputSchema = Schema.Struct({
  projectId: Schema.optional(projectIdSchema),
  documentTransform: Schema.optional(documentTransformSchema),
  title: Schema.Trim.check(Schema.isBetweenLength(1, 200)),
  kind: materialGenerationKindSchema,
  inputVersionIds: Schema.mutable(Schema.Array(materialVersionIdSchema)).check(
    Schema.isBetweenLength(0, 20)
  ),
  instruction: Schema.optional(Schema.Trim.check(Schema.isBetweenLength(1, 100000))),
  scopeId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  questionSpec: Schema.optional(
    Schema.Struct({ count: Schema.Literal(1), kind: Schema.Literals(['choice', 'open']) })
  )
}).check(
  Schema.makeFilter(
    (value) =>
      new Set(value.inputVersionIds).size === value.inputVersionIds.length &&
      (value.questionSpec === undefined || value.kind === 'quiz') &&
      validGenerationScope(value)
  )
);

function validGenerationScope(value: {
  kind: typeof materialGenerationKindSchema.Type;
  documentTransform?: typeof documentTransformSchema.Type;
  projectId?: typeof projectIdSchema.Type;
  scopeId?: string;
  inputVersionIds: readonly (typeof materialVersionIdSchema.Type)[];
}) {
  if (value.kind === 'document')
    return (
      value.documentTransform !== undefined &&
      value.projectId === undefined &&
      value.scopeId === undefined
    );

  return (
    value.documentTransform === undefined &&
    value.projectId !== undefined &&
    value.inputVersionIds.length > 0
  );
}

export const materialGenerationPayloadSchema = Schema.Struct({
  documentTransform: materialGenerationInputSchema.fields.documentTransform,
  inputVersionIds: materialGenerationInputSchema.fields.inputVersionIds,
  title: materialGenerationInputSchema.fields.title,
  kind: materialGenerationKindSchema,
  instruction: materialGenerationInputSchema.fields.instruction,
  scopeId: materialGenerationInputSchema.fields.scopeId,
  questionSpec: materialGenerationInputSchema.fields.questionSpec
});

export const materialGenerationSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  ...materialGenerationInputSchema.fields
});

export const materialGenerationSnapshotSchema = Schema.Struct({
  ...materialGenerationSchema.fields,
  documentIds: Schema.Array(documentIdSchema),
  cancelled: Schema.Boolean,
  report: Schema.NullOr(documentTransformReportSchema),
  resultVersionId: Schema.NullOr(materialVersionIdSchema)
});

export const materialOperationSchema = Schema.Literals([
  'original',
  'edit',
  'summarize',
  'translate',
  'generate',
  'extract',
  'transcribe'
]);

export const materialStatusSchema = Schema.Literals(['draft', 'published']);

export const materialCreatorSchema = Schema.Literals(['user', 'agent', 'import']);

export const materialAnchorSchema = anchorSchema;

export const materialDocumentSchema = documentSchema;

const materialDocumentInputIsValid = (document: typeof materialDocumentSchema.Type) =>
  Schema.is(documentSchema)(document) &&
  document.blocks.every((block) => block.anchor.type === 'authored');

const quizChoiceInputSchema = Schema.Struct({ text: nonemptySchema, isCorrect: Schema.Boolean });

const choiceQuestionFields = {
  prompt: nonemptySchema,
  explanation: nonemptySchema,
  choices: Schema.mutable(Schema.Array(quizChoiceInputSchema)).check(Schema.isBetweenLength(2, 100))
};

const singleChoiceInputSchema = Schema.Struct({
  kind: Schema.Literal('single_choice'),
  ...choiceQuestionFields
}).check(
  Schema.makeFilter(
    (question: { choices: readonly { isCorrect: boolean }[] }) =>
      question.choices.filter((choice) => choice.isCorrect).length === 1
  )
);

const multipleChoiceInputSchema = Schema.Struct({
  kind: Schema.Literal('multiple_choice'),
  ...choiceQuestionFields
}).check(
  Schema.makeFilter((question: { choices: readonly { isCorrect: boolean }[] }) =>
    question.choices.some((choice) => choice.isCorrect)
  )
);

const openQuestionInputSchema = Schema.Struct({
  kind: Schema.Literal('open'),
  prompt: nonemptySchema,
  explanation: nonemptySchema,
  referenceAnswer: nonemptySchema
});

export const materialQuestionInputSchema = Schema.Union([
  singleChoiceInputSchema,
  multipleChoiceInputSchema,
  openQuestionInputSchema
]);

const optionalIdSchema = Schema.optional(materialCardIdSchema);

const nonnegativeNullableBigIntSchema = Schema.NullOr(
  Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 9223372036854775807n }))
);

const positiveNullableBigIntSchema = Schema.NullOr(
  Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n }))
);

export const materialDiagramContentInputSchema = Schema.Struct({
  kind: Schema.Literal('diagram'),
  format: Schema.Literal('mermaid'),
  payload: nonemptySchema
});

export const materialQuizContentInputSchema = Schema.Struct({
  kind: Schema.Literal('quiz'),
  questions: Schema.mutable(Schema.Array(materialQuestionInputSchema)).check(Schema.isMinLength(1))
});

export const materialFlashcardsContentInputSchema = Schema.Struct({
  kind: Schema.Literal('flashcards'),
  cards: Schema.mutable(
    Schema.Array(
      Schema.Struct({ cardId: optionalIdSchema, front: nonemptySchema, back: nonemptySchema })
    )
  ).check(Schema.isMinLength(1))
}).check(
  Schema.makeFilter(
    (content: { cards: readonly { cardId?: bigint; front: string; back: string }[] }) => {
      const ids = content.cards.flatMap((card) => (card.cardId === undefined ? [] : [card.cardId]));

      return new Set(ids).size === ids.length;
    }
  )
);

const pairedDimensions = Schema.makeFilter(
  (content: { width: bigint | null; height: bigint | null }) =>
    (content.width === null) === (content.height === null)
);

export const materialContentInputSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('file'), sourceId: sourceIdSchema }),
  Schema.Struct({
    kind: Schema.Literal('audio'),
    sourceId: sourceIdSchema,
    durationMs: nonnegativeNullableBigIntSchema,
    sampleRate: positiveNullableBigIntSchema,
    channels: positiveNullableBigIntSchema
  }),
  Schema.Struct({
    kind: Schema.Literal('video'),
    sourceId: sourceIdSchema,
    durationMs: nonnegativeNullableBigIntSchema,
    width: positiveNullableBigIntSchema,
    height: positiveNullableBigIntSchema
  }).check(pairedDimensions),
  Schema.Struct({
    kind: Schema.Literal('image'),
    sourceId: sourceIdSchema,
    width: positiveNullableBigIntSchema,
    height: positiveNullableBigIntSchema
  }).check(pairedDimensions),
  Schema.Struct({ kind: Schema.Literal('link'), sourceId: sourceIdSchema }),
  Schema.Struct({ kind: Schema.Literal('document'), ...materialDocumentSchema.fields }).check(
    Schema.makeFilter(materialDocumentInputIsValid)
  ),
  materialDiagramContentInputSchema,
  materialQuizContentInputSchema,
  materialFlashcardsContentInputSchema
]);

export const materialGenerationPublicationSchema = Schema.Struct({
  report: Schema.optional(documentTransformReportSchema),
  generationEventId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  requestId: Schema.String.check(Schema.isMinLength(1)),
  content: materialContentInputSchema,
  citations: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        marker: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 4294967295n })),
        inputVersionId: materialVersionIdSchema,
        blockOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        target: Schema.optional(documentTextRangeSchema),
        quote: Schema.String.check(Schema.isMinLength(1))
      })
    )
  ),
  language: Schema.optional(Schema.NullOr(Schema.Trim.check(Schema.isBetweenLength(1, 64))))
});

const importedExtractionFields = {
  extracted: Schema.NullOr(Schema.Struct({ id: documentIdSchema, document: documentSchema }))
};

const fileContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('file'),
  sourceId: sourceIdSchema,
  ...importedExtractionFields,
  source: sourceSchema
});

const audioContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('audio'),
  sourceId: sourceIdSchema,
  ...importedExtractionFields,
  source: sourceSchema,
  durationMs: nonnegativeNullableBigIntSchema,
  sampleRate: positiveNullableBigIntSchema,
  channels: positiveNullableBigIntSchema
});

const videoContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('video'),
  sourceId: sourceIdSchema,
  ...importedExtractionFields,
  source: sourceSchema,
  durationMs: nonnegativeNullableBigIntSchema,
  width: positiveNullableBigIntSchema,
  height: positiveNullableBigIntSchema
});

const imageContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('image'),
  sourceId: sourceIdSchema,
  ...importedExtractionFields,
  source: sourceSchema,
  width: positiveNullableBigIntSchema,
  height: positiveNullableBigIntSchema
});

const linkContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('link'),
  sourceId: sourceIdSchema,
  ...importedExtractionFields,
  source: sourceSchema
});

const documentContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('document'),
  ...materialDocumentSchema.fields
});

const diagramContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('diagram'),
  format: Schema.Literal('mermaid'),
  payload: Schema.String
});

const quizContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('quiz'),
  questions: Schema.mutable(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: quizQuestionIdSchema,
          kind: Schema.Literal('single_choice'),
          prompt: Schema.String,
          explanation: Schema.String,
          choices: Schema.mutable(
            Schema.Array(
              Schema.Struct({
                id: quizChoiceIdSchema,
                text: Schema.String,
                isCorrect: Schema.Boolean
              })
            )
          )
        }),
        Schema.Struct({
          id: quizQuestionIdSchema,
          kind: Schema.Literal('multiple_choice'),
          prompt: Schema.String,
          explanation: Schema.String,
          choices: Schema.mutable(
            Schema.Array(
              Schema.Struct({
                id: quizChoiceIdSchema,
                text: Schema.String,
                isCorrect: Schema.Boolean
              })
            )
          )
        }),
        Schema.Struct({
          id: quizQuestionIdSchema,
          kind: Schema.Literal('open'),
          prompt: Schema.String,
          explanation: Schema.String,
          referenceAnswer: Schema.String
        })
      ])
    )
  )
});

const flashcardContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('flashcards'),
  cards: Schema.mutable(
    Schema.Array(
      Schema.Struct({ cardId: materialCardIdSchema, front: Schema.String, back: Schema.String })
    )
  )
});

export const materialContentDetailSchema = Schema.Union([
  fileContentDetailSchema,
  audioContentDetailSchema,
  videoContentDetailSchema,
  imageContentDetailSchema,
  linkContentDetailSchema,
  documentContentDetailSchema,
  diagramContentDetailSchema,
  quizContentDetailSchema,
  flashcardContentDetailSchema
]);

export const materialVersionSummarySchema = Schema.Struct({
  availability: Schema.optional(Schema.Literals(['available', 'unavailable'])),
  id: materialVersionIdSchema,
  material_id: materialIdSchema,
  kind: materialKindSchema,
  number: Schema.BigInt,
  status: materialStatusSchema,
  operation: materialOperationSchema,
  creator: materialCreatorSchema,
  instruction: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  created_at: Schema.BigInt,
  published_at: Schema.NullOr(Schema.BigInt)
});

const materialVersionBaseFields = {
  id: materialVersionIdSchema,
  material_id: materialIdSchema,
  number: Schema.BigInt,
  operation: materialOperationSchema,
  creator: materialCreatorSchema,
  instruction: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  created_at: Schema.BigInt,
  inputs: Schema.mutable(Schema.Array(materialVersionIdSchema)),
  parents: Schema.mutable(Schema.Array(materialVersionIdSchema))
};

const materialVersionDetailFor = <
  StatusSchema extends Schema.Codec<'draft' | 'published'>,
  PublishedAtSchema extends Schema.Codec<bigint | null>
>(
  status: StatusSchema,
  publishedAt: PublishedAtSchema
) =>
  Schema.Union([
    Schema.Struct({
      ...materialVersionBaseFields,
      status,
      published_at: publishedAt,
      kind: Schema.Literal('file'),
      content: fileContentDetailSchema
    }),
    Schema.Struct({
      ...materialVersionBaseFields,
      status,
      published_at: publishedAt,
      kind: Schema.Literal('audio'),
      content: audioContentDetailSchema
    }),
    Schema.Struct({
      ...materialVersionBaseFields,
      status,
      published_at: publishedAt,
      kind: Schema.Literal('video'),
      content: videoContentDetailSchema
    }),
    Schema.Struct({
      ...materialVersionBaseFields,
      status,
      published_at: publishedAt,
      kind: Schema.Literal('image'),
      content: imageContentDetailSchema
    }),
    Schema.Struct({
      ...materialVersionBaseFields,
      status,
      published_at: publishedAt,
      kind: Schema.Literal('link'),
      content: linkContentDetailSchema
    }),
    Schema.Struct({
      ...materialVersionBaseFields,
      status,
      published_at: publishedAt,
      kind: Schema.Literal('document'),
      content: documentContentDetailSchema
    }),
    Schema.Struct({
      ...materialVersionBaseFields,
      status,
      published_at: publishedAt,
      kind: Schema.Literal('diagram'),
      content: diagramContentDetailSchema
    }),
    Schema.Struct({
      ...materialVersionBaseFields,
      status,
      published_at: publishedAt,
      kind: Schema.Literal('quiz'),
      content: quizContentDetailSchema
    }),
    Schema.Struct({
      ...materialVersionBaseFields,
      status,
      published_at: publishedAt,
      kind: Schema.Literal('flashcards'),
      content: flashcardContentDetailSchema
    })
  ]);

export const materialVersionDetailSchema = materialVersionDetailFor(
  materialStatusSchema,
  Schema.NullOr(Schema.BigInt)
);

export const publishedMaterialVersionDetailSchema = materialVersionDetailFor(
  Schema.Literal('published'),
  Schema.BigInt
);

export const draftMaterialVersionDetailSchema = materialVersionDetailFor(
  Schema.Literal('draft'),
  Schema.Null
);

export const materialSchema = Schema.Struct({
  description: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(240)))),
  importProcessing: Schema.optional(
    Schema.Struct({
      sourceId: sourceIdSchema,
      revision: Schema.Int,
      requestId: Schema.String,
      status: Schema.Literals(['pending', 'ready', 'failed'])
    })
  ),
  projectIds: Schema.Array(projectIdSchema),
  id: materialIdSchema,
  kind: materialKindSchema,
  title: Schema.String,
  created_at: Schema.BigInt,
  updated_at: Schema.BigInt,
  archived_at: Schema.NullOr(Schema.BigInt)
});

export const materialSummarySchema = Schema.Struct({
  ...materialSchema.fields,
  version: materialVersionSummarySchema,
  latestPublishedVersion: Schema.NullOr(materialVersionSummarySchema),
  latestDraftVersion: Schema.NullOr(materialVersionSummarySchema)
});

export const materialDetailSchema = Schema.Struct({
  ...materialSchema.fields,
  version: materialVersionDetailSchema,
  latestPublishedVersion: Schema.NullOr(publishedMaterialVersionDetailSchema),
  latestDraftVersion: Schema.NullOr(draftMaterialVersionDetailSchema)
});

export const materialCitationSchema = Schema.Struct({
  precision: Schema.optional(Schema.Literals(['exact', 'approximate', 'unavailable'])),
  support: Schema.optional(citationSupportSchema),
  evidence: Schema.optional(evidenceResolutionSchema),
  marker: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 4294967295n })),
  inputVersionId: materialVersionIdSchema,
  anchor: materialAnchorSchema,
  target: Schema.optional(documentTextRangeSchema),
  quote: nonemptySchema
});

const uniqueMaterialLinks = Schema.makeFilter(
  (links: { inputs?: readonly bigint[]; parents?: readonly bigint[] }) =>
    [links.inputs, links.parents].every(
      (ids) => ids === undefined || new Set(ids).size === ids.length
    )
);

export const materialLinksInputSchema = Schema.Struct({
  inputs: Schema.optional(
    Schema.mutable(Schema.Array(materialVersionIdSchema)).check(Schema.isMaxLength(1000))
  ),
  parents: Schema.optional(
    Schema.mutable(Schema.Array(materialVersionIdSchema)).check(Schema.isMaxLength(1000))
  )
}).check(uniqueMaterialLinks);

export const createMaterialVersionInputSchema = Schema.Struct({
  ...materialLinksInputSchema.fields,
  content: materialContentInputSchema,
  operation: Schema.optional(materialOperationSchema),
  language: Schema.optional(Schema.NullOr(Schema.Trim.check(Schema.isBetweenLength(1, 64)))),
  publish: Schema.optional(Schema.Boolean)
}).check(uniqueMaterialLinks);

export const createMaterialInputSchema = Schema.Struct({
  ...createMaterialVersionInputSchema.fields,
  projectId: Schema.optional(projectIdSchema),
  sessionId: Schema.optional(sessionIdSchema),
  title: Schema.Trim.check(Schema.isBetweenLength(1, 200))
}).check(uniqueMaterialLinks);

export const materialPageSchema = Schema.Struct({
  cursor: Schema.optional(materialIdSchema),
  take: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(50))
  )
});

export type MaterialContentInput = typeof materialContentInputSchema.Type;

export type MaterialKind = typeof materialKindSchema.Type;

export type MaterialOperation = typeof materialOperationSchema.Type;

export type MaterialVersionSummary = typeof materialVersionSummarySchema.Type;

export type MaterialVersionDetailDto = typeof materialVersionDetailSchema.Type;

export type MaterialSummaryDto = typeof materialSummarySchema.Type;

export type MaterialDetailDto = typeof materialDetailSchema.Type;

export type MaterialCitation = typeof materialCitationSchema.Type;
