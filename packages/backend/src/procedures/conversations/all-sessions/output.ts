import { Schema } from 'effect';

import { sessionSchema } from '#backend/shared/conversations/schemas';

export const outputSchema = Schema.Struct({ items: Schema.mutable(Schema.Array(sessionSchema)) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
