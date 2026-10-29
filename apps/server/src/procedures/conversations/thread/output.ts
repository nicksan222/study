import { Schema } from 'effect';

import { messageViewSchema, messagePartViewSchema } from '#server/shared/conversations/schemas';

export const outputSchema = Schema.Struct({
  value: Schema.NullOr(
    Schema.Struct({
      sessionId: Schema.NullOr(Schema.BigInt),
      messageId: Schema.NullOr(Schema.BigInt),
      openedAt: Schema.BigInt,
      root: messagePartViewSchema,
      replies: Schema.mutable(Schema.Array(messageViewSchema))
    })
  )
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
