import { Schema } from 'effect';

import { recordingViewSchema } from '#backend/shared/recordings/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(Schema.Array(recordingViewSchema))
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
