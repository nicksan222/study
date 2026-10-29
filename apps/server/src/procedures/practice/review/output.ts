import { Schema } from 'effect';

import { memorySchema } from '#server/shared/practice/schemas';

export const outputSchema = Schema.Struct({ value: Schema.NullOr(memorySchema) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
