import { Schema } from 'effect';

import {
  projectIdSchema,
  sessionIdSchema,
  messageIdSchema,
  versionIdSchema,
  sourceIdSchema,
  chunkIdSchema,
  contentSnapshotIdSchema,
  studyDocumentIdSchema,
  studyDocumentVersionIdSchema,
  materialIdSchema,
  materialVersionIdSchema,
  quizQuestionIdSchema
} from '../ids.ts';
import { anchorSchema } from '../sources/schemas.ts';
import { projectSearchTargetSchema, sessionSearchTargetSchema } from './targets.ts';

/** A registry-owned identity for new entities without a dedicated application target yet. */
export const registeredEntityKeySchema = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand('RegisteredEntityKey')
);

export const searchTargetSchema = Schema.Union([
  projectSearchTargetSchema,
  sessionSearchTargetSchema,
  Schema.Struct({
    type: Schema.Literal('message'),
    messageId: messageIdSchema,
    sessionId: sessionIdSchema,
    versionId: versionIdSchema
  }),
  Schema.Struct({ type: Schema.Literal('source'), sourceId: sourceIdSchema }),
  Schema.Struct({
    type: Schema.Literal('passage'),
    chunkId: chunkIdSchema,
    sourceId: sourceIdSchema,
    documentId: contentSnapshotIdSchema,
    anchor: anchorSchema
  }),
  Schema.Struct({
    type: Schema.Literal('document'),
    documentId: studyDocumentIdSchema,
    versionId: studyDocumentVersionIdSchema
  }),
  Schema.Struct({
    type: Schema.Literal('material'),
    materialId: materialIdSchema,
    versionId: materialVersionIdSchema
  }),
  Schema.Struct({
    type: Schema.Literal('question'),
    questionId: quizQuestionIdSchema,
    materialId: materialIdSchema,
    versionId: materialVersionIdSchema
  }),
  Schema.Struct({
    type: Schema.Literal('registered'),
    entity: Schema.String.check(Schema.isMinLength(1)),
    key: registeredEntityKeySchema
  })
]);

export type SearchTarget = typeof searchTargetSchema.Type;

export const semanticSearchInputSchema = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  kinds: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMaxLength(32))
  ),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })))
});

export const semanticSearchHitSchema = Schema.Struct({
  target: searchTargetSchema,
  title: Schema.String,
  text: Schema.String,
  distance: Schema.Number
});

export const searchEntityCatalogSchema = Schema.Array(
  Schema.Struct({
    kind: Schema.String,
    description: Schema.String,
    filters: Schema.Array(Schema.Literals(['kind', 'project'])),
    citations: Schema.Boolean
  })
);

const searchProjectionSchema = Schema.Struct({
  target: searchTargetSchema,
  title: Schema.String,
  text: Schema.String,
  projectIds: Schema.Array(projectIdSchema),
  revision: Schema.String
});

export const searchProjectionPageInputSchema = Schema.Struct({
  kind: Schema.optional(Schema.String),
  targets: Schema.optional(Schema.Array(searchTargetSchema).check(Schema.isMaxLength(1000))),
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))
});

export const searchProjectionPageSchema = Schema.Struct({
  items: Schema.Array(searchProjectionSchema),
  next: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
});

export type SemanticSearchInput = typeof semanticSearchInputSchema.Type;

export type SemanticSearchHit = typeof semanticSearchHitSchema.Type;

export type SearchEntityCatalog = typeof searchEntityCatalogSchema.Type;

export type SearchProjection = typeof searchProjectionSchema.Type;

export type SearchProjectionPageInput = typeof searchProjectionPageInputSchema.Type;

export type SearchProjectionPage = typeof searchProjectionPageSchema.Type;
