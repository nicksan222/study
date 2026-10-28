import { Schema } from 'effect';

import { recordingViewSchema } from '#backend/shared/recordings/schemas';

export const outputSchema = recordingViewSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
