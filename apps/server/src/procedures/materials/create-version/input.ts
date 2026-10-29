import { Schema } from 'effect';

import {
  createMaterialVersionInputSchema,
  materialIdSchema
} from '#server/shared/materials/schemas';

export const inputSchema = Schema.Struct({
  ...createMaterialVersionInputSchema.fields,
  materialId: materialIdSchema
}).check(
  Schema.makeFilter(
    (value: typeof createMaterialVersionInputSchema.Type & { materialId: bigint }) =>
      [value.inputs, value.parents].every(
        (ids) => ids === undefined || new Set(ids).size === ids.length
      )
  )
);

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
