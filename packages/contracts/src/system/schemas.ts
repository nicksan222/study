import { Schema } from 'effect';

import {
  studyDocumentIdSchema,
  materialIdSchema,
  materialVersionIdSchema,
  projectIdSchema,
  quizQuestionIdSchema,
  sessionIdSchema,
  sourceIdSchema
} from '../ids.ts';
import { materialKindSchema } from '../materials/schemas.ts';
import { anchorSchema } from '../sources/schemas.ts';
import { sourceKinds } from '../sources/sniff.ts';

export const searchKindSchema = Schema.Literals([
  'project',
  'session',
  'message',
  'source',
  'passage',
  'material',
  'document',
  'question'
]);

const materialSearchTargetSchema = Schema.Struct({
  type: Schema.Literal('material'),
  materialId: materialIdSchema,
  versionId: materialVersionIdSchema,
  materialKind: materialKindSchema
});

export const searchHitSchema = Schema.Struct({
  kind: Schema.Literals([
    'project',
    'session',
    'message',
    'source',
    'material',
    'document',
    'question'
  ]),
  title: Schema.String,
  at: Schema.BigInt,
  context: Schema.optional(Schema.String),
  excerpt: Schema.optional(Schema.String),
  fileKind: Schema.optional(Schema.Literals(sourceKinds)),
  target: Schema.Union([
    Schema.Struct({
      type: Schema.Literal('project'),
      id: projectIdSchema
    }),
    Schema.Struct({
      type: Schema.Literal('session'),
      sessionId: sessionIdSchema
    }),
    Schema.Struct({ type: Schema.Literal('document'), documentId: studyDocumentIdSchema }),
    materialSearchTargetSchema,
    Schema.Struct({
      type: Schema.Literal('question'),
      materialId: materialIdSchema,
      versionId: materialVersionIdSchema,
      questionId: quizQuestionIdSchema
    }),
    Schema.Struct({
      type: Schema.Literal('source'),
      sourceId: sourceIdSchema,
      anchor: Schema.optional(anchorSchema)
    })
  ])
});

const materialSearchHitSchema = Schema.Struct({
  ...searchHitSchema.fields,
  kind: Schema.Literal('material'),
  target: materialSearchTargetSchema
});

export const materialSearchResultSchema = Schema.Struct({
  semantic: Schema.Literal(false),
  hits: Schema.Array(materialSearchHitSchema)
});

export const searchResultSchema = Schema.Struct({
  semantic: Schema.Boolean,
  hits: Schema.Array(searchHitSchema)
});
