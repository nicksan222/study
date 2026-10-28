import { Schema } from 'effect';

export const outputSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('picture'), bytes: Schema.Uint8Array }),
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('unavailable') })
]);

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
