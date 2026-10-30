import { sourceSchema } from '@study/contracts/sources/schemas';
import { Schema } from 'effect';

// The persisted JSON has the canonical Source fields with a SQLite-friendly hash encoding.
const persistedSource = Schema.fromJsonString(
  Schema.toCodecJson(Schema.Struct({ ...sourceSchema.fields, sha256: Schema.Uint8ArrayFromHex }))
);

export const encodeSourceSnapshot = Schema.encodeSync(persistedSource);

export const decodeSourceSnapshot = Schema.decodeUnknownSync(persistedSource);
