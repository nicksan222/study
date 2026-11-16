import { Schema } from 'effect';

/** Derived study concepts retain original passage markers, never replacement evidence. */
export const materialStudyNotesSchema = Schema.Struct({
  notes: Schema.Array(
    Schema.Struct({
      text: Schema.String.check(Schema.isBetweenLength(1, 600)),
      markers: Schema.Array(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4294967295 }))
      ).check(
        Schema.isBetweenLength(1, 8),
        Schema.makeFilter((markers) => new Set(markers).size === markers.length)
      )
    })
  ).check(Schema.isMaxLength(16))
});
