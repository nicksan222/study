import { Schema } from 'effect';

import { materialEntityIdSchema } from '#backend/shared/material/schemas';
import { setCardChangeSchema } from '#backend/shared/material/schemas';

export const inputSchema = Schema.Struct({
  artifact: materialEntityIdSchema,
  index: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 1000000 })),
  change: setCardChangeSchema
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
