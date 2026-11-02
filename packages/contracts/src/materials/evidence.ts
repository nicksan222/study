/** Exact retained navigation is independent of provenance and epistemic support. */
import { Schema } from 'effect';

import {
  materialAnnotationIdSchema,
  materialIdSchema,
  materialVersionIdSchema,
  sourceIdSchema
} from '../ids.ts';
import { anchorSchema, blockSchema, documentTextRangeSchema } from '../sources/schemas.ts';

export const evidenceTargetSchema = Schema.Struct({
  materialId: materialIdSchema,
  range: documentTextRangeSchema
});

export const evidenceReferenceSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('range'), target: evidenceTargetSchema }),
  Schema.Struct({
    kind: Schema.Literal('anchor'),
    versionId: materialVersionIdSchema,
    anchor: anchorSchema,
    quote: Schema.String
  })
]);

export const evidenceRevisionSchema = Schema.Struct({
  inputVersionId: materialVersionIdSchema,
  currentVersionId: Schema.NullOr(materialVersionIdSchema),
  inputDocumentId: Schema.NullOr(documentTextRangeSchema.fields.documentId),
  currentDocumentId: Schema.NullOr(documentTextRangeSchema.fields.documentId),
  source: Schema.NullOr(
    Schema.Struct({
      sourceId: sourceIdSchema,
      inputRevision: Schema.Int,
      currentRevision: Schema.NullOr(Schema.Int),
      inputDocumentId: Schema.NullOr(documentTextRangeSchema.fields.documentId),
      /** Last committed extraction; replacement may still be awaiting its next extraction. */
      currentDocumentId: Schema.NullOr(documentTextRangeSchema.fields.documentId)
    })
  ),
  state: Schema.Literals(['current', 'stale', 'unavailable'])
});

export const evidenceResolutionSchema = Schema.Union([
  Schema.Struct({
    availability: Schema.Literal('unavailable'),
    reference: evidenceReferenceSchema,
    reason: Schema.Literals([
      'version_missing',
      'version_pruned',
      'material_mismatch',
      'document_missing',
      'document_mismatch',
      'block_missing',
      'range_invalid'
    ]),
    precision: Schema.Literal('unavailable')
  }),
  Schema.Struct({
    availability: Schema.Literal('available'),
    reference: evidenceReferenceSchema,
    materialId: materialIdSchema,
    origin: Schema.Literals(['user', 'agent', 'import']),
    precision: Schema.Literals(['exact', 'approximate']),
    location: anchorSchema,
    locationPrecision: Schema.Literals(['approximate', 'unavailable']),
    block: Schema.NullOr(blockSchema),
    excerpt: Schema.NullOr(Schema.String),
    revision: evidenceRevisionSchema
  })
]);

/** User judgments pin both revisions and a citation snapshot; they are never independent verification. */
export const assessCitationSchema = Schema.Struct({
  claim: evidenceTargetSchema,
  evidence: evidenceTargetSchema,
  marker: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 4294967295n })),
  judgment: Schema.Literals(['supports', 'contradicts', 'uncertain']),
  note: Schema.String.check(Schema.isMaxLength(100000))
});

export const citationAssessmentSchema = Schema.Struct({
  ...assessCitationSchema.fields,
  suppliedBy: Schema.Literal('user'),
  independentVerification: Schema.Literal(false),
  citation: Schema.Struct({
    anchor: anchorSchema,
    quote: Schema.String,
    target: documentTextRangeSchema
  })
});

export const citationSupportInputSchema = Schema.Struct({
  versionId: materialVersionIdSchema,
  marker: assessCitationSchema.fields.marker
});

export const citationSupportSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal('unassessed') }),
  Schema.Struct({
    state: Schema.Literals(['assessed', 'stale', 'unavailable']),
    assessment: citationAssessmentSchema,
    claim: evidenceResolutionSchema,
    evidence: evidenceResolutionSchema,
    reasons: Schema.Array(
      Schema.Literals([
        'claim_changed',
        'evidence_changed',
        'citation_changed',
        'target_unavailable'
      ])
    )
  })
]);

const revision = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const annotationKeySchema = Schema.Struct({ id: materialAnnotationIdSchema });

const annotationContentSchema = Schema.Struct({
  kind: Schema.Literals(['highlight', 'note']),
  note: Schema.String.check(Schema.isMaxLength(100000))
});

export const createAnnotationSchema = Schema.Struct({
  target: evidenceTargetSchema,
  ...annotationContentSchema.fields
});

export const annotationRevisionSchema = Schema.Struct({
  id: materialAnnotationIdSchema,
  revision,
  target: evidenceTargetSchema,
  ...annotationContentSchema.fields,
  deleted: Schema.Boolean,
  operation: Schema.Literals(['create', 'update', 'reanchor', 'delete'])
});

export const annotationSchema = Schema.Struct({
  ...annotationRevisionSchema.fields,
  evidence: evidenceResolutionSchema
});

export const annotationMutationSchema = Schema.Struct({
  ...annotationKeySchema.fields,
  expectedRevision: revision
});

export const updateAnnotationSchema = Schema.Struct({
  ...annotationMutationSchema.fields,
  ...annotationContentSchema.fields
});

export const reanchorAnnotationSchema = Schema.Struct({
  ...annotationMutationSchema.fields,
  target: evidenceTargetSchema
});

export const annotationOutcomeSchema = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal('saved'), annotation: annotationSchema }),
  Schema.Struct({
    outcome: Schema.Literal('conflict'),
    current: annotationSchema,
    submitted: Schema.Union([
      updateAnnotationSchema,
      reanchorAnnotationSchema,
      annotationMutationSchema
    ])
  }),
  Schema.Struct({
    outcome: Schema.Literal('unavailable'),
    current: Schema.NullOr(annotationSchema),
    evidence: Schema.NullOr(evidenceResolutionSchema)
  })
]);

export const annotationPageInputSchema = Schema.Struct({
  materialId: materialIdSchema,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  cursor: Schema.optional(materialAnnotationIdSchema)
});

export const annotationPageSchema = Schema.Struct({
  items: Schema.Array(annotationSchema),
  nextCursor: Schema.NullOr(materialAnnotationIdSchema)
});

export const annotationHistoryInputSchema = Schema.Struct({
  ...annotationKeySchema.fields,
  limit: annotationPageInputSchema.fields.limit,
  cursor: Schema.optional(revision)
});

export const annotationHistorySchema = Schema.Struct({
  items: Schema.Array(annotationRevisionSchema),
  nextCursor: Schema.NullOr(revision)
});

export const dependencyPageSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({ dependentVersionId: materialVersionIdSchema, ...evidenceRevisionSchema.fields })
  ),
  nextCursor: Schema.NullOr(materialVersionIdSchema)
});
