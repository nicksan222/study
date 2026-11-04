import { Schema } from 'effect';

import {
  studyDocumentIdSchema,
  studyDocumentVersionIdSchema,
  studyDocumentAnnotationIdSchema,
  contentSnapshotIdSchema
} from '../ids.ts';
import { blockIdSchema } from '../sources/schemas.ts';
import { exactInputSchema, citationSchema } from './schemas.ts';
export const rangeSchema = Schema.Struct({
  versionId: studyDocumentVersionIdSchema,
  snapshotId: contentSnapshotIdSchema,
  blockId: blockIdSchema,
  start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  end: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}).check(Schema.makeFilter((r) => r.end >= r.start));
export const annotationTargetSchema = Schema.Struct({
  documentId: studyDocumentIdSchema,
  range: rangeSchema
});
const content = {
  kind: Schema.Literals(['highlight', 'note']),
  note: Schema.String.check(Schema.isMaxLength(100000))
};
export const annotationKeySchema = Schema.Struct({ id: studyDocumentAnnotationIdSchema });
export const createAnnotationSchema = Schema.Struct({ target: annotationTargetSchema, ...content });
export const annotationSchema = Schema.Struct({
  ...annotationKeySchema.fields,
  revision: Schema.BigInt,
  target: annotationTargetSchema,
  ...content,
  deleted: Schema.Boolean,
  operation: Schema.Literals(['create', 'update', 'reanchor', 'delete'])
});
export const reviseAnnotationSchema = Schema.Struct({
  ...annotationKeySchema.fields,
  expectedRevision: Schema.BigInt,
  target: annotationTargetSchema,
  ...content,
  deleted: Schema.Boolean
});
export const annotationOutcomeSchema = Schema.Struct({
  outcome: Schema.Literals(['saved', 'conflict']),
  annotation: annotationSchema
});
export const annotationHistorySchema = Schema.Struct({
  ...annotationKeySchema.fields,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  cursor: Schema.optional(Schema.BigInt)
});
export const annotationPageSchema = Schema.Struct({
  items: Schema.Array(annotationSchema),
  nextCursor: Schema.NullOr(Schema.BigInt)
});
export const assessmentSchema = Schema.Struct({
  claim: annotationTargetSchema,
  evidence: exactInputSchema,
  evidenceRange: Schema.Struct({ blockId: blockIdSchema, start: Schema.Int, end: Schema.Int }),
  marker: citationSchema.fields.marker,
  judgment: Schema.Literals(['supports', 'contradicts', 'uncertain']),
  note: Schema.String.check(Schema.isMaxLength(100000)),
  suppliedBy: Schema.Literal('user'),
  independentVerification: Schema.Literal(false),
  citation: citationSchema
});

export const annotationsSchema = Schema.Struct({
  documentId: studyDocumentIdSchema,
  versionId: Schema.optional(studyDocumentVersionIdSchema),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  cursor: Schema.optional(studyDocumentAnnotationIdSchema),
  includeDeleted: Schema.Boolean
});
export const annotationsPageSchema = Schema.Struct({
  items: Schema.Array(annotationSchema),
  nextCursor: Schema.NullOr(studyDocumentAnnotationIdSchema)
});

export const assessCitationSchema = Schema.Struct({
  claim: annotationTargetSchema,
  evidence: exactInputSchema,
  evidenceRange: assessmentSchema.fields.evidenceRange,
  marker: citationSchema.fields.marker,
  judgment: assessmentSchema.fields.judgment,
  note: assessmentSchema.fields.note
});
export const assessmentsInputSchema = Schema.Struct({
  versionId: studyDocumentVersionIdSchema,
  marker: Schema.optional(citationSchema.fields.marker),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  cursor: Schema.optional(Schema.BigInt)
});
export const assessmentRecordSchema = Schema.Struct({
  id: Schema.BigInt,
  assessment: assessmentSchema
});
export const assessmentViewSchema = Schema.Struct({
  ...assessmentRecordSchema.fields,
  state: Schema.Literals(['assessed', 'stale', 'unavailable'])
});
export const assessmentsPageSchema = Schema.Struct({
  items: Schema.Array(assessmentViewSchema),
  nextCursor: Schema.NullOr(Schema.BigInt)
});
