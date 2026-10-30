import { Schema } from 'effect';

export const visionTranscriptionInputSchema = Schema.Struct({
  prompt: Schema.String,
  data: Schema.declare<Uint8Array>((value): value is Uint8Array => value instanceof Uint8Array),
  mediaType: Schema.String
});

export const visionTranscriptionOutputSchema = Schema.Struct({
  pages: Schema.Array(
    Schema.Struct({
      page: Schema.Int,
      blocks: Schema.Array(
        Schema.Struct({
          kind: Schema.Literals(['paragraph', 'heading', 'list_item', 'table', 'code']),
          text: Schema.String
        })
      )
    })
  )
});
