import { Effect, Schema } from 'effect';

import { anchorSchema, documentSchema } from '#backend/shared/sources/schemas';
import { sourceKinds } from '#backend/shared/sources/sniff';

export const materialIdSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

const isNatural = (value: number) => Number.isInteger(value) && value >= 0;

const nonemptySchema = Schema.Trim.check(Schema.isMinLength(1));

const nullableIdSchema = Schema.NullOr(materialIdSchema);

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
  document.blocks.length > 0 &&
  document.blocks.every(({ anchor }) => {
    switch (anchor.type) {
      case 'time':
        return (
          isNatural(anchor.startMs) && isNatural(anchor.endMs) && anchor.endMs >= anchor.startMs
        );
      case 'page':
        return Number.isInteger(anchor.page) && anchor.page >= 1;
      case 'text':
        return (
          isNatural(anchor.lineStart) &&
          isNatural(anchor.lineEnd) &&
          isNatural(anchor.start) &&
          isNatural(anchor.end) &&
          anchor.lineEnd >= anchor.lineStart &&
          anchor.end >= anchor.start
        );
      case 'slide':
      case 'paragraph':
        return isNatural(anchor.index);
      case 'url':
        try {
          new URL(anchor.url);

          return true;
        } catch {
          return false;
        }
      default:
        return true;
    }
  });

const quizChoiceInputSchema = Schema.Struct({ text: nonemptySchema, isCorrect: Schema.Boolean });

const singleChoiceInputSchema = Schema.Struct({
  kind: Schema.Literal('single_choice'),
  prompt: nonemptySchema,
  explanation: nonemptySchema,
  choices: Schema.mutable(Schema.Array(quizChoiceInputSchema)).check(Schema.isBetweenLength(2, 100))
}).check(
  Schema.makeFilter(
    (question: { choices: readonly { isCorrect: boolean }[] }) =>
      question.choices.filter((choice) => choice.isCorrect).length === 1
  )
);

const multipleChoiceInputSchema = Schema.Struct({
  kind: Schema.Literal('multiple_choice'),
  prompt: nonemptySchema,
  explanation: nonemptySchema,
  choices: Schema.mutable(Schema.Array(quizChoiceInputSchema)).check(Schema.isBetweenLength(2, 100))
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

const optionalIdSchema = Schema.optional(materialIdSchema);

const nonnegativeNullableBigIntSchema = Schema.NullOr(
  Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 9223372036854775807n }))
);

const positiveNullableBigIntSchema = Schema.NullOr(
  Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n }))
);

export const materialContentInputSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('file'), sourceId: materialIdSchema }),
  Schema.Struct({
    kind: Schema.Literal('audio'),
    sourceId: materialIdSchema,
    durationMs: nonnegativeNullableBigIntSchema,
    sampleRate: positiveNullableBigIntSchema,
    channels: positiveNullableBigIntSchema
  }),
  Schema.Struct({
    kind: Schema.Literal('video'),
    sourceId: materialIdSchema,
    durationMs: nonnegativeNullableBigIntSchema,
    width: positiveNullableBigIntSchema,
    height: positiveNullableBigIntSchema
  }).check(
    Schema.makeFilter(
      (content: { width: bigint | null; height: bigint | null }) =>
        (content.width === null) === (content.height === null)
    )
  ),
  Schema.Struct({
    kind: Schema.Literal('image'),
    sourceId: materialIdSchema,
    width: positiveNullableBigIntSchema,
    height: positiveNullableBigIntSchema
  }).check(
    Schema.makeFilter(
      (content: { width: bigint | null; height: bigint | null }) =>
        (content.width === null) === (content.height === null)
    )
  ),
  Schema.Struct({ kind: Schema.Literal('link'), sourceId: materialIdSchema }),
  Schema.Struct({ kind: Schema.Literal('document'), ...materialDocumentSchema.fields }).check(
    Schema.makeFilter(materialDocumentInputIsValid)
  ),
  Schema.Struct({
    kind: Schema.Literal('diagram'),
    format: Schema.Literal('mermaid'),
    payload: nonemptySchema
  }),
  Schema.Struct({
    kind: Schema.Literal('quiz'),
    questions: Schema.mutable(Schema.Array(materialQuestionInputSchema)).check(
      Schema.isMinLength(1)
    )
  }),
  Schema.Struct({
    kind: Schema.Literal('flashcards'),
    cards: Schema.mutable(
      Schema.Array(
        Schema.Struct({ cardId: optionalIdSchema, front: nonemptySchema, back: nonemptySchema })
      )
    ).check(Schema.isMinLength(1))
  }).check(
    Schema.makeFilter(
      (content: { cards: readonly { cardId?: bigint; front: string; back: string }[] }) => {
        const ids = content.cards.flatMap((card) =>
          card.cardId === undefined ? [] : [card.cardId]
        );

        return new Set(ids).size === ids.length;
      }
    )
  )
]);

export const sourceSchema = Schema.Struct({
  id: materialIdSchema,
  project_id: nullableIdSchema,
  origin: Schema.Literals(['attachment', 'import', 'note', 'recording', 'web']),
  kind: Schema.Literals(sourceKinds),
  mime: Schema.String,
  name: Schema.String,
  size_bytes: Schema.BigInt,
  sha256: Schema.instanceOf(Buffer),
  uri: Schema.NullOr(Schema.String),
  created_at: Schema.BigInt
});

const fileContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('file'),
  sourceId: materialIdSchema,
  source: sourceSchema
});

const audioContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('audio'),
  sourceId: materialIdSchema,
  source: sourceSchema,
  durationMs: nonnegativeNullableBigIntSchema,
  sampleRate: positiveNullableBigIntSchema,
  channels: positiveNullableBigIntSchema
});

const videoContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('video'),
  sourceId: materialIdSchema,
  source: sourceSchema,
  durationMs: nonnegativeNullableBigIntSchema,
  width: positiveNullableBigIntSchema,
  height: positiveNullableBigIntSchema
});

const imageContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('image'),
  sourceId: materialIdSchema,
  source: sourceSchema,
  width: positiveNullableBigIntSchema,
  height: positiveNullableBigIntSchema
});

const linkContentDetailSchema = Schema.Struct({
  kind: Schema.Literal('link'),
  sourceId: materialIdSchema,
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
          id: materialIdSchema,
          kind: Schema.Literal('single_choice'),
          prompt: Schema.String,
          explanation: Schema.String,
          choices: Schema.mutable(
            Schema.Array(
              Schema.Struct({
                id: materialIdSchema,
                text: Schema.String,
                isCorrect: Schema.Boolean
              })
            )
          )
        }),
        Schema.Struct({
          id: materialIdSchema,
          kind: Schema.Literal('multiple_choice'),
          prompt: Schema.String,
          explanation: Schema.String,
          choices: Schema.mutable(
            Schema.Array(
              Schema.Struct({
                id: materialIdSchema,
                text: Schema.String,
                isCorrect: Schema.Boolean
              })
            )
          )
        }),
        Schema.Struct({
          id: materialIdSchema,
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
      Schema.Struct({ cardId: materialIdSchema, front: Schema.String, back: Schema.String })
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
  id: materialIdSchema,
  material_id: materialIdSchema,
  project_id: materialIdSchema,
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
  id: materialIdSchema,
  material_id: materialIdSchema,
  project_id: materialIdSchema,
  number: Schema.BigInt,
  operation: materialOperationSchema,
  creator: materialCreatorSchema,
  instruction: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  created_at: Schema.BigInt,
  inputs: Schema.mutable(Schema.Array(materialIdSchema)),
  parents: Schema.mutable(Schema.Array(materialIdSchema))
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
  id: materialIdSchema,
  project_id: materialIdSchema,
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
  marker: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 4294967295n })),
  inputVersionId: materialIdSchema,
  anchor: materialAnchorSchema,
  quote: nonemptySchema
});

export const materialLinksInputSchema = Schema.Struct({
  inputs: Schema.optional(
    Schema.mutable(Schema.Array(materialIdSchema)).check(Schema.isMaxLength(1000))
  ),
  parents: Schema.optional(
    Schema.mutable(Schema.Array(materialIdSchema)).check(Schema.isMaxLength(1000))
  )
}).check(
  Schema.makeFilter((links: { inputs?: readonly bigint[]; parents?: readonly bigint[] }) =>
    [links.inputs, links.parents].every(
      (ids) => ids === undefined || new Set(ids).size === ids.length
    )
  )
);

export const createMaterialVersionInputSchema = Schema.Struct({
  ...materialLinksInputSchema.fields,
  content: materialContentInputSchema,
  operation: Schema.optional(materialOperationSchema),
  language: Schema.optional(Schema.NullOr(Schema.Trim.check(Schema.isBetweenLength(1, 64)))),
  publish: Schema.optional(Schema.Boolean)
}).check(
  Schema.makeFilter((links: { inputs?: readonly bigint[]; parents?: readonly bigint[] }) =>
    [links.inputs, links.parents].every(
      (ids) => ids === undefined || new Set(ids).size === ids.length
    )
  )
);

export const createMaterialInputSchema = Schema.Struct({
  ...createMaterialVersionInputSchema.fields,
  projectId: materialIdSchema,
  sessionId: Schema.optional(materialIdSchema),
  title: Schema.Trim.check(Schema.isBetweenLength(1, 200))
}).check(
  Schema.makeFilter((links: { inputs?: readonly bigint[]; parents?: readonly bigint[] }) =>
    [links.inputs, links.parents].every(
      (ids) => ids === undefined || new Set(ids).size === ids.length
    )
  )
);

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
