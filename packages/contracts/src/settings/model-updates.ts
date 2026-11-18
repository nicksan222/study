import { Schema } from 'effect';

const identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

export const modelUpdateSchema = Schema.Struct({
  provider: identifier,
  family: identifier,
  model: identifier,
  previousModel: identifier
});

export type ModelUpdate = typeof modelUpdateSchema.Type;
