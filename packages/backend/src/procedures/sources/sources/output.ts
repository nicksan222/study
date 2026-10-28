import { Schema } from 'effect';

import { sourceSchema } from '#backend/shared/sources/schemas';

export const outputSchema = Schema.Struct({ items: Schema.mutable(Schema.Array(sourceSchema)) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
