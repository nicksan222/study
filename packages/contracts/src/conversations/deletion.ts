import { Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';
import { sessionIdSchema } from '../ids.ts';

/** Deletion is accepted before cleanup completes; failures contain no captured content. */
export const sessionDeletionSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  operationId: Schema.String,
  status: Schema.Literals(['pending', 'failed', 'completed']),
  errorKind: Schema.NullOr(errorKindSchema),
  attempt: Schema.Int,
  completedAt: Schema.NullOr(Schema.BigInt)
});
