/** Exact deletion scope and content-free durable cleanup status. */
import { Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';
import { materialIdSchema, materialVersionIdSchema, noteIdSchema } from '../ids.ts';

export const materialDeletionKeySchema = Schema.Struct({ materialId: materialIdSchema });

export const materialDeletionPreviewSchema = Schema.Struct({
  materialId: materialIdSchema,
  token: Schema.String,
  versionIds: Schema.Array(materialVersionIdSchema),
  noteIds: Schema.Array(noteIdSchema),
  privateRequestIds: Schema.Array(Schema.String)
});

export const requestMaterialDeletionSchema = Schema.Struct({
  materialId: materialIdSchema,
  token: Schema.String
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
