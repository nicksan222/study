import { Schema } from 'effect';

import { documentWithIdSchema } from '#server/shared/sources/schemas';

export const outputSchema = Schema.Struct({ value: Schema.NullOr(documentWithIdSchema) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
