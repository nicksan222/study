import { Schema } from 'effect';

import { asyncIterableOutputValidator } from '#backend/shared/schema-validator';

export const outputSchema = Schema.Struct({ type: Schema.Literal('refresh') });

export type Output = typeof outputSchema.Type;

export const outputValidator = asyncIterableOutputValidator(outputSchema);
