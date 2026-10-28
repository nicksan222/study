import { Schema } from 'effect';

import { materialEntityIdSchema } from '#backend/shared/material/schemas';

export const inputSchema = Schema.Struct({
  project: materialEntityIdSchema,
  kind: Schema.Literals(['flashcards', 'diagram'])
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
