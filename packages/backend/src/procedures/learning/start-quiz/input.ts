import { Schema } from 'effect';

import { learningIdSchema } from '#backend/shared/learning/schemas';

export const inputSchema = Schema.Struct({ versionId: learningIdSchema });

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
