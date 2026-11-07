import { Effect, Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';
import {
  materialCardIdSchema,
  materialIdSchema,
  materialVersionIdSchema,
  projectIdSchema,
  quizQuestionIdSchema,
  quizChoiceIdSchema,
  sessionIdSchema
} from '../ids.ts';
import { contentInputSchema, contentInputKey, contentRangeSchema } from '../inputs.ts';
import { learningCitationSchema } from './inputs.ts';

export { materialIdSchema };

const nonemptySchema = Schema.Trim.check(Schema.isMinLength(1));

export const materialKindSchema = Schema.Literals(['diagram', 'quiz', 'flashcards']);

export const materialGenerationKindSchema = Schema.Literals(['flashcards', 'diagram', 'quiz']);

export const quizGenerationConfigSchema = Schema.Struct({
  questionCount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  choiceCount: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 6 })),
  questionKind: Schema.Literals(['mixed', 'choice', 'open', 'fill_blank']),
  difficulty: Schema.Literals(['easy', 'balanced', 'challenging'])
});

export const materialGenerationInputSchema = Schema.Struct({
  projectId: Schema.optional(projectIdSchema),
  title: Schema.Trim.check(Schema.isBetweenLength(1, 200)),
  autoTitle: Schema.optional(Schema.Boolean),
  kind: materialGenerationKindSchema,
  inputs: Schema.mutable(Schema.Array(contentInputSchema)).check(Schema.isBetweenLength(1, 20)),
  instruction: Schema.optional(Schema.Trim.check(Schema.isBetweenLength(1, 100000))),
  scopeId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  questionSpec: Schema.optional(
    Schema.Struct({ count: Schema.Literal(1), kind: Schema.Literals(['choice', 'open']) })
  ),
  quizConfig: Schema.optional(quizGenerationConfigSchema)
}).check(
  Schema.makeFilter(
    (value) =>
      new Set(value.inputs.map(contentInputKey)).size === value.inputs.length &&
      (value.questionSpec === undefined || value.kind === 'quiz') &&
      (value.quizConfig === undefined ||
        (value.kind === 'quiz' && value.questionSpec === undefined)) &&
      validGenerationScope(value)
  )
);

function validGenerationScope(value: {
  kind: typeof materialGenerationKindSchema.Type;
  projectId?: typeof projectIdSchema.Type;
  scopeId?: string;
  inputs: readonly (typeof contentInputSchema.Type)[];
}) {
  return value.projectId !== undefined && value.inputs.length > 0;
}

export const materialGenerationPayloadSchema = Schema.Struct({
  inputs: materialGenerationInputSchema.fields.inputs,
  title: materialGenerationInputSchema.fields.title,
  autoTitle: materialGenerationInputSchema.fields.autoTitle,
  kind: materialGenerationKindSchema,
  instruction: materialGenerationInputSchema.fields.instruction,
  scopeId: materialGenerationInputSchema.fields.scopeId,
  questionSpec: materialGenerationInputSchema.fields.questionSpec,
  quizConfig: materialGenerationInputSchema.fields.quizConfig
});

export const materialGenerationSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  ...materialGenerationInputSchema.fields
});

export const materialGenerationSnapshotSchema = Schema.Struct({
  ...materialGenerationSchema.fields,
  cancelled: Schema.Boolean,
  errorKind: Schema.NullOr(errorKindSchema),
  resultVersionId: Schema.NullOr(materialVersionIdSchema)
});

export const materialOperationSchema = Schema.Literals(['original', 'edit', 'generate']);

export const materialStatusSchema = Schema.Literals(['draft', 'published']);

export const materialCreatorSchema = Schema.Literals(['user', 'agent']);

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
  openQuestionInputSchema,
  Schema.Struct({
    kind: Schema.Literal('fill_blank'),
    prompt: nonemptySchema.check(
      Schema.makeFilter((prompt) => {
        const blanks = prompt.match(/_{4,}/g);

        return blanks?.length === 1 && blanks[0] === '____';
      })
    ),
    explanation: nonemptySchema,
    referenceAnswer: nonemptySchema
  })
]);

/** Narrows question kinds whose learner response and reference answer are text rather than choice identities. */
export function isTextQuestionKind(
  kind: (typeof materialQuestionInputSchema.Type)['kind']
): kind is 'open' | 'fill_blank' {
  return kind === 'open' || kind === 'fill_blank';
}

const optionalIdSchema = Schema.optional(materialCardIdSchema);

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

export const materialContentInputSchema = Schema.Union([
  materialDiagramContentInputSchema,
  materialQuizContentInputSchema,
  materialFlashcardsContentInputSchema
]);

export const titledQuizGenerationOutputSchema = Schema.Struct({
  title: materialGenerationInputSchema.fields.title,
  content: materialQuizContentInputSchema
});

export const titledFlashcardsGenerationOutputSchema = Schema.Struct({
  title: materialGenerationInputSchema.fields.title,
  content: materialFlashcardsContentInputSchema
});

export const titledDiagramGenerationOutputSchema = Schema.Struct({
  title: materialGenerationInputSchema.fields.title,
  content: materialDiagramContentInputSchema
});

export const materialGenerationPublicationSchema = Schema.Struct({
  generationEventId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  requestId: Schema.String.check(Schema.isMinLength(1)),
  title: materialGenerationInputSchema.fields.title.pipe(Schema.optional),
  content: materialContentInputSchema,
  citations: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        marker: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 4294967295n })),
        input: contentInputSchema,
        blockOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        target: Schema.optional(contentRangeSchema),
        quote: Schema.String.check(Schema.isMinLength(1))
      })
    )
  ),
  language: Schema.optional(Schema.NullOr(Schema.Trim.check(Schema.isBetweenLength(1, 64))))
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
        }),
        Schema.Struct({
          id: quizQuestionIdSchema,
          kind: Schema.Literal('fill_blank'),
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
  inputs: Schema.mutable(Schema.Array(contentInputSchema)),
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

export const materialCitationSchema = learningCitationSchema;

const uniqueMaterialLinks = Schema.makeFilter(
  (links: { inputs?: readonly (typeof contentInputSchema.Type)[]; parents?: readonly bigint[] }) =>
    (links.inputs === undefined ||
      new Set(links.inputs.map(contentInputKey)).size === links.inputs.length) &&
    (links.parents === undefined || new Set(links.parents).size === links.parents.length)
);

export const materialLinksInputSchema = Schema.Struct({
  inputs: Schema.optional(
    Schema.mutable(Schema.Array(contentInputSchema)).check(Schema.isMaxLength(1000))
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
