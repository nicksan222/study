import { Schema } from 'effect';

export const sourcesInputSchema = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1))
});

export const sourceEvidenceSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  text: Schema.String
});

export const sourcesOutputSchema = Schema.Array(sourceEvidenceSchema);
