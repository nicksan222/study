import { Schema } from 'effect';

import { materialVersionIdSchema } from '../ids.ts';
import {
  materialContentInputSchema,
  materialKindSchema,
  materialGenerationSnapshotSchema
} from '../materials/schemas.ts';

export const materialNoveltyItemSchema = Schema.Struct({
  prompt: Schema.String.check(Schema.isMaxLength(4000)),
  key: Schema.String.check(Schema.isMaxLength(24000))
});

/** Comparison references do not retain prior exercise bodies after retirement. */
export const materialGenerationHistoryReferencesSchema = Schema.Struct({
  versions: Schema.Array(materialVersionIdSchema).check(Schema.isMaxLength(20)),
  limited: Schema.Boolean
});

export const materialGenerationHistorySchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      ...materialNoveltyItemSchema.fields,
      versionId: materialVersionIdSchema
    })
  ).check(Schema.isMaxLength(100)),
  limited: Schema.Boolean
});

export const materialGenerationPlanSchema = Schema.Struct({
  focus: Schema.Array(Schema.String.check(Schema.isBetweenLength(1, 300))).check(
    Schema.isBetweenLength(1, 16)
  )
});

export const materialNoveltyReviewSchema = Schema.Struct({
  duplicates: Schema.Array(
    Schema.Struct({
      index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 49 })),
      reason: Schema.Literals(['history_duplicate', 'candidate_duplicate'])
    })
  ).check(Schema.isMaxLength(50))
});

export const materialGenerationPlanInputSchema = Schema.Struct({
  kind: materialKindSchema,
  request: Schema.String.check(Schema.isMaxLength(101000)),
  history: materialGenerationHistorySchema
});

export const materialNoveltyReviewInputSchema = Schema.Struct({
  history: materialGenerationHistorySchema,
  candidate: materialContentInputSchema
});

/** Procedure receipts retain references rather than readable historical exercise bodies. */
export const materialGenerationProcedureInputSchema = Schema.Struct({
  request: materialGenerationSnapshotSchema,
  generationEventId: Schema.String.check(Schema.isMinLength(1))
});

export const materialGenerationHistoryInputSchema = Schema.Struct({
  requestId: Schema.String.check(Schema.isMinLength(1))
});

export const materialGenerationPlanProcedureInputSchema = Schema.Struct({
  ...materialGenerationProcedureInputSchema.fields,
  prompt: Schema.String.check(Schema.isMaxLength(101000)),
  history: materialGenerationHistoryReferencesSchema
});

export const materialGenerationCandidateInputSchema = Schema.Struct({
  ...materialGenerationProcedureInputSchema.fields,
  prompt: Schema.String,
  plan: materialGenerationPlanSchema,
  history: materialGenerationHistoryReferencesSchema,
  feedback: Schema.String,
  scope: Schema.String.check(Schema.isMinLength(1))
});

export const materialNoveltyProcedureInputSchema = Schema.Struct({
  ...materialGenerationProcedureInputSchema.fields,
  history: materialGenerationHistoryReferencesSchema,
  candidate: materialContentInputSchema
});
