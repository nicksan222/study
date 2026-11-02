import { Schema } from 'effect';

import { documentTransformReportSchema } from '../materials/schemas.ts';
import { blockContentSchema } from '../sources/schemas.ts';

/** Transient provider output uses ordinals until fresh canonical blocks exist. */
export const documentTransformOutputSchema = Schema.Struct({
  blocks: Schema.Array(Schema.toEncoded(Schema.toCodecJson(blockContentSchema))).check(
    Schema.isBetweenLength(1, 200)
  ),
  notes: Schema.Array(
    Schema.Struct({
      kind: documentTransformReportSchema.fields.notes.value.fields.kind,
      explanation: documentTransformReportSchema.fields.notes.value.fields.explanation,
      blockOrdinals: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
    })
  ).check(Schema.isBetweenLength(1, 200))
});
