import { Schema } from 'effect';

export const inputSchema = Schema.Struct({ json: Schema.String.check(Schema.isMaxLength(65536)) });

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
