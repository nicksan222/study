import { Schema } from 'effect';

export const inputSchema = Schema.Struct({ name: Schema.String });

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
