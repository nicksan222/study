import { Effect, Schema } from 'effect';

import { materialIdSchema, materialPageSchema } from '#server/shared/materials/schemas';

export const inputSchema = Schema.Struct({
  ...materialPageSchema.fields,
  projectId: materialIdSchema,
  sessionId: Schema.optional(materialIdSchema),
  archived: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false)))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
