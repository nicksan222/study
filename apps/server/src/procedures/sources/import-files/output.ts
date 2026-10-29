import { Schema } from 'effect';

import { sourceSchema } from '#server/shared/sources/schemas';

const itemSchema = Schema.Union([
  Schema.Struct({ path: Schema.String, type: Schema.Literal('source'), source: sourceSchema }),
  Schema.Struct({
    path: Schema.String,
    type: Schema.Literal('error'),
    error: Schema.Struct({
      kind: Schema.Literals([
        'auth',
        'cancelled',
        'config',
        'internal',
        'invalid_input',
        'model_unavailable',
        'not_enough',
        'not_found',
        'rate_limited',
        'transient',
        'unsupported'
      ]),
      message: Schema.String
    })
  })
]);

export const outputSchema = Schema.Struct({ items: Schema.mutable(Schema.Array(itemSchema)) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
