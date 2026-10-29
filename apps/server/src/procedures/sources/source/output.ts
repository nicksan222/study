import { Schema } from 'effect';

import { sourceSchema } from '#server/shared/sources/schemas';

export const outputSchema = Schema.Struct({ value: Schema.NullOr(sourceSchema) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
