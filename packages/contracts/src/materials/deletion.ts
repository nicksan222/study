/** Exact deletion scope and content-free durable cleanup status. */
import { Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';
import {
  materialIdSchema,
  materialVersionIdSchema,
  sourceIdSchema,
  sessionIdSchema
} from '../ids.ts';

export const materialDeletionKeySchema = Schema.Struct({ materialId: materialIdSchema });

export const materialDeletionPreviewSchema = Schema.Struct({
  materialId: materialIdSchema,
  token: Schema.String,
  descendants: Schema.Array(materialIdSchema),
  materials: Schema.Array(
    Schema.Struct({
      materialId: materialIdSchema,
      versionIds: Schema.Array(materialVersionIdSchema),
      unavailable: Schema.Boolean
    })
  ),
  missingEvidence: Schema.Literal('exact_deleted_input_versions'),
  versionIds: Schema.Array(materialVersionIdSchema),
  references: Schema.Array(
    Schema.Struct({
      dependentMaterialId: materialIdSchema,
      inputVersionId: materialVersionIdSchema
    })
  ),
  sourceIds: Schema.Array(sourceIdSchema),
  sharedImageSourceIds: Schema.Array(sourceIdSchema),
  sessionIds: Schema.Array(sessionIdSchema),
  retainedMessageCitationCount: Schema.Int,
  privateRequestIds: Schema.Array(Schema.String),
  retainedCopies: Schema.Literal('unselected_materials_and_published_messages_including_recordings')
});

export const requestMaterialDeletionSchema = Schema.Struct({
  materialId: materialIdSchema,
  token: Schema.String,
  descendantIds: Schema.Array(materialIdSchema)
});

export const materialDeletionSchema = Schema.Struct({
  materialId: materialIdSchema,
  operationId: Schema.String,
  materialIds: Schema.Array(materialIdSchema),
  status: Schema.Literals(['pending', 'failed', 'completed']),
  phase: Schema.Literals(['accepted', 'retired', 'completed']),
  attempt: Schema.Int,
  errorKind: Schema.NullOr(errorKindSchema),
  completedAt: Schema.NullOr(Schema.BigInt)
});
