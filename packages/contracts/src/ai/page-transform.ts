import { Schema } from 'effect';

import { transformReportSchema } from '../pages/transform.ts';
import { blockContentSchema } from '../sources/schemas.ts';

/** Transient provider output uses ordinals until fresh canonical blocks exist. */
export const pageTransformOutputSchema = Schema.Struct({
  blocks: Schema.Array(Schema.toEncoded(Schema.toCodecJson(blockContentSchema))).check(
    Schema.isBetweenLength(1, 200)
  ),
  notes: Schema.Array(
    Schema.Struct({
      kind: transformReportSchema.fields.notes.value.fields.kind,
      explanation: transformReportSchema.fields.notes.value.fields.explanation,
      blockOrdinals: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
        description:
          'Zero-based indexes into the returned blocks array: 0 is the first block and blocks.length - 1 is the last. Use [] for a note about the whole page.'
      })
    })
  ).check(Schema.isBetweenLength(1, 200))
});
