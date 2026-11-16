/** @file Owns reply schemas within this feature. */

import {
  replyRequestInputSchema,
  replySnapshotSchema,
  runSelectionContextSchema
} from '@study/contracts';
import { Schema } from 'effect';

export const codec = Schema.fromJsonString(Schema.toCodecJson(replySnapshotSchema));

export const persistedCodec = Schema.fromJsonString(
  Schema.toCodecJson(
    Schema.Struct({
      ...replySnapshotSchema.fields,
      publication: Schema.optional(Schema.String),
      publicationText: Schema.optional(Schema.String)
    })
  )
);

export const requestInput = Schema.Struct({
  ...replyRequestInputSchema.fields,
  requestId: Schema.String,
  context: Schema.optional(runSelectionContextSchema)
});
