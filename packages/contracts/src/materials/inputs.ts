import { Schema } from 'effect';

import { contentInputSchema, contentRangeSchema } from '../inputs.ts';
import { anchorSchema } from '../sources/schemas.ts';

export const learningCitationSchema = Schema.Struct({
  marker: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 4294967295n })),
  input: contentInputSchema,
  anchor: anchorSchema,
  target: Schema.optional(contentRangeSchema),
  quote: Schema.String.check(Schema.isMinLength(1))
});
