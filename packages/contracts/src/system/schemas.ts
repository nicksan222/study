import { Schema } from 'effect';

import {
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
  'question'
]);

export const searchHitSchema = Schema.Struct({
  kind: Schema.Literals(['project', 'session', 'message', 'source', 'material', 'question']),
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
      projectId: projectIdSchema,
      sessionId: sessionIdSchema
    }),
    Schema.Struct({
      type: Schema.Literal('material'),
      projectId: projectIdSchema,
      materialId: materialIdSchema,
      versionId: materialVersionIdSchema,
      materialKind: materialKindSchema
    }),
    Schema.Struct({
      type: Schema.Literal('question'),
      projectId: projectIdSchema,
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

export const searchResultSchema = Schema.Struct({
  semantic: Schema.Boolean,
  hits: Schema.Array(searchHitSchema)
});
