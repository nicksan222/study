/** Browser-safe authored identities, exact provenance and canonical anchored content. */
import { Schema } from 'effect';

import {
  studyDocumentIdSchema,
  projectIdSchema,
  studyDocumentVersionIdSchema,
  contentSnapshotIdSchema,
  sourceIdSchema,
  versionIdSchema
} from '../ids.ts';
import { documentSchema, anchorSchema, blockIdSchema } from '../sources/schemas.ts';

export const authoredContentSchema = documentSchema.check(
  Schema.makeFilter((d) => d.blocks.length > 0)
);
export const exactInputSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('document'), versionId: studyDocumentVersionIdSchema }),
  Schema.Struct({
    kind: Schema.Literal('source'),
    sourceId: sourceIdSchema,
    revision: Schema.BigInt.check(Schema.isGreaterThanBigInt(0n)),
    snapshotId: Schema.NullOr(contentSnapshotIdSchema)
  }),
  Schema.Struct({ kind: Schema.Literal('message'), versionId: versionIdSchema })
]);
export const citationSchema = Schema.Struct({
  marker: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4294967295 })),
  input: exactInputSchema,
  anchor: anchorSchema,
  target: Schema.NullOr(
    Schema.Struct({ blockId: blockIdSchema, start: Schema.Int, end: Schema.Int })
  ),
  quote: Schema.String.check(Schema.isMinLength(1))
});
export const versionSchema = Schema.Struct({
  id: studyDocumentVersionIdSchema,
  documentId: studyDocumentIdSchema,
  number: Schema.BigInt,
  status: Schema.Literals(['draft', 'published']),
  operation: Schema.Literals(['original', 'edit', 'summarize', 'translate', 'generate', 'restore']),
  creator: Schema.Literals(['user', 'agent']),
  snapshotId: contentSnapshotIdSchema,
  instruction: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt,
  publishedAt: Schema.NullOr(Schema.BigInt),
  parents: Schema.Array(studyDocumentVersionIdSchema),
  inputs: Schema.Array(exactInputSchema),
  citations: Schema.Array(citationSchema),
  document: documentSchema
});
export const summarySchema = Schema.Struct({
  projectIds: Schema.Array(projectIdSchema),
  id: studyDocumentIdSchema,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt,
  archivedAt: Schema.NullOr(Schema.BigInt),
  headVersionId: Schema.NullOr(studyDocumentVersionIdSchema)
});
export const detailSchema = Schema.Struct({
  ...summarySchema.fields,
  version: Schema.NullOr(versionSchema)
});
export const documentPageSchema = Schema.Struct({
  items: Schema.Array(summarySchema),
  nextCursor: Schema.NullOr(studyDocumentIdSchema)
});
export const versionPageSchema = Schema.Struct({
  items: Schema.Array(versionSchema),
  nextCursor: Schema.NullOr(studyDocumentVersionIdSchema)
});
