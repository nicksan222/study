import { Schema } from 'effect';

import { sessionSchema } from '#server/shared/conversations/schemas';

export const outputSchema = Schema.Struct({ value: Schema.NullOr(sessionSchema) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
