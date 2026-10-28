import { Schema } from 'effect';

import { messageViewSchema } from '#backend/shared/conversations/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(Schema.Array(messageViewSchema))
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
