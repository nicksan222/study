/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Adapts an Effect schema to the Standard Schema interface used by AI SDK tools and  │
 * │ outputs. The adapter preserves the corresponding JSON Schema for provider requests.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports standardSchema. It combines Standard Schema validation with the JSON Schema    │
 * │   generated from the same Effect schema.                                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ AI SDK tool and output adapters call this conversion; Effect schemas remain the          │
 * │ canonical validation definitions.                                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Schema } from 'effect';

/** Expose the same Effect schema for validation and JSON Schema generation. */
export function standardSchema<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const validator = Schema.toStandardSchemaV1(schema);
  const json = Schema.toStandardJSONSchemaV1(schema);

  return { '~standard': { ...validator['~standard'], jsonSchema: json['~standard'].jsonSchema } };
}
