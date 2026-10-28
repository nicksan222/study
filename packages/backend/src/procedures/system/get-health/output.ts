import { Schema } from 'effect';

export const outputSchema = Schema.Struct({
  protocolVersion: Schema.Number,
  workersRunning: Schema.Boolean,
  testMode: Schema.Boolean
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
