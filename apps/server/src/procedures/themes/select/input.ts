import { Schema } from 'effect';

export const inputSchema = Schema.Struct({
  id: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
