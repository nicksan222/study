import { Schema } from 'effect';

import { sourceKinds } from '#backend/shared/sources/sniff';

export const inputSchema = Schema.Struct({
  kind: Schema.Literals(sourceKinds),
  mime: Schema.optional(Schema.NullOr(Schema.String))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
