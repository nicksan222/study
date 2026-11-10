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
import type { JsonSchema } from 'effect';

function object(value: unknown): value is JsonSchema.JsonSchema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Strict providers require every declared field; encoded optional values already allow null. */
function providerSchema(schema: JsonSchema.JsonSchema): JsonSchema.JsonSchema {
  const result = { ...schema };

  for (const key of ['properties', '$defs', 'definitions']) {
    const entries = schema[key];

    if (object(entries))
      result[key] = Object.fromEntries(
        Object.entries(entries).map(([name, value]) => [
          name,
          object(value) ? providerSchema(value) : value
        ])
      );
  }

  for (const key of ['items', 'additionalProperties', 'anyOf', 'oneOf', 'allOf']) {
    const value = schema[key];

    if (Array.isArray(value))
      result[key] = value.map((item) => (object(item) ? providerSchema(item) : item));
    else if (object(value)) result[key] = providerSchema(value);
  }

  // Keep dictionary value schemas intact rather than silently discarding dynamic keys.
  if (
    schema.type === 'object' &&
    object(schema.properties) &&
    !object(schema.additionalProperties)
  ) {
    result.additionalProperties = false;
    result.required = Object.keys(schema.properties);
  }

  return result;
}

/** Expose the same Effect schema for validation and JSON Schema generation. */
export function standardSchema<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const validator = Schema.toStandardSchemaV1(schema);
  const json = Schema.toStandardJSONSchemaV1(schema);
  const converter = json['~standard'].jsonSchema;

  return {
    '~standard': {
      ...validator['~standard'],
      jsonSchema: {
        input: (...args: Parameters<typeof converter.input>) =>
          providerSchema(converter.input(...args)),
        output: (...args: Parameters<typeof converter.output>) =>
          providerSchema(converter.output(...args))
      }
    }
  };
}
