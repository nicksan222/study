import { Schema, Effect } from 'effect';

import { sourceKinds } from '#backend/shared/sources/sniff';

export const inputSchema = Schema.Struct({
  kind: Schema.Literals(sourceKinds),
  mime: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed('')))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
