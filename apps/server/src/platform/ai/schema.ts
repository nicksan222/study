import { Schema } from 'effect';

/** Expose the same Effect schema for validation and JSON Schema generation. */
export function standardSchema<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const validator = Schema.toStandardSchemaV1(schema);
  const json = Schema.toStandardJSONSchemaV1(schema);

  return { '~standard': { ...validator['~standard'], jsonSchema: json['~standard'].jsonSchema } };
}
