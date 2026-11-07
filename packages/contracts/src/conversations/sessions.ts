import { Schema } from 'effect';

import { sessionIdSchema, recordingIdSchema } from '../ids.ts';
import type { sessionSchema, titleSourceSchema } from './schemas.ts';

export type TitleSource = typeof titleSourceSchema.Type;

export type ChatSession = typeof sessionSchema.Type;

/** Internal transaction participants copy content into the same new notebook. */
export const copySessionContentSchema = Schema.Struct({
  sessionIds: Schema.Array(sessionIdSchema).check(Schema.isBetweenLength(2, 20)),
  targetSessionId: sessionIdSchema
});

export const recordingCopySchema = Schema.Struct({
  originalId: recordingIdSchema,
  copiedId: recordingIdSchema
});
