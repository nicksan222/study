/** Explicit retention never schedules destructive work. Exact acceptance pins the entire impact. */
import { Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';
import {
  materialIdSchema,
  materialVersionIdSchema,
  sourceIdSchema,
  documentIdSchema
} from '../ids.ts';

export const historyPolicySchema = Schema.Struct({
  keepLatest: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))
});

export const historyScopeSchema = Schema.Struct({
  materialId: materialIdSchema,
  policy: historyPolicySchema
});

export const historyOperationKeySchema = Schema.Struct({
  operationId: Schema.String.check(Schema.isBetweenLength(1, 200))
});

export const historyVersionIdsSchema = Schema.Array(materialVersionIdSchema).check(
  Schema.isMaxLength(100),
  Schema.makeFilter((ids: readonly bigint[]) => new Set(ids).size === ids.length)
);

export const historyPreviewSchema = Schema.Struct({
  ...historyScopeSchema.fields,
  token: Schema.String,
  candidateIds: historyVersionIdsSchema,
  hasMore: Schema.Boolean,
  protected: Schema.Array(
    Schema.Struct({
      versionId: materialVersionIdSchema,
      reason: Schema.Literals(['keep_latest', 'draft', 'proposal', 'source_root'])
    })
  ),
  references: Schema.Array(
    Schema.Struct({
      versionId: materialVersionIdSchema,
      dependentVersionId: materialVersionIdSchema,
      relationship: Schema.Literals(['input', 'parent'])
    })
  ),
  privateRequestIds: Schema.Array(Schema.String),
  retainedMessageCitationCount: Schema.Int,
  sourceRevisions: Schema.Array(
    Schema.Struct({
      sourceId: sourceIdSchema,
      revision: Schema.BigInt,
      bytes: Schema.BigInt,
      retained: Schema.Boolean,
      retainedVersionIds: Schema.Array(materialVersionIdSchema),
      retainedDocumentIds: Schema.Array(documentIdSchema),
      currentSourceRevision: Schema.Boolean
    })
  ),
  /** UTF-8 bytes in stored body columns; source BLOB lengths are reported separately. */
  removedBodyBytes: Schema.BigInt,
  byteSemantics: Schema.Literal('logical_body_columns_and_source_blobs'),
  missingEvidence: Schema.Literal('exact_pruned_versions'),
  retainedCopies: Schema.Literal('other_versions_and_published_messages')
});

export const requestHistoryPruneSchema = Schema.Struct({
  ...historyScopeSchema.fields,
  ...historyOperationKeySchema.fields,
  token: Schema.String.check(Schema.isBetweenLength(64, 64)),
  candidateIds: historyVersionIdsSchema
});

export const historyPruneSchema = Schema.Struct({
  ...historyOperationKeySchema.fields,
  materialId: materialIdSchema,
  policy: historyPolicySchema,
  candidateIds: historyVersionIdsSchema,
  status: Schema.Literals(['pending', 'failed', 'completed']),
  attempt: Schema.Int,
  errorKind: Schema.NullOr(errorKindSchema),
  completedAt: Schema.NullOr(Schema.BigInt)
});
