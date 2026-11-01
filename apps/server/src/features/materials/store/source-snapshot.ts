/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds a stable snapshot of source data used by material projection or generation. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Captures stable source revision data for downstream material processing.               │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sourceSchema } from '@study/contracts/sources/schemas';
import { Schema } from 'effect';

// The persisted JSON has the canonical Source fields with a SQLite-friendly hash encoding.
const persistedSource = Schema.fromJsonString(
  Schema.toCodecJson(Schema.Struct({ ...sourceSchema.fields, sha256: Schema.Uint8ArrayFromHex }))
);

export const encodeSourceSnapshot = Schema.encodeSync(persistedSource);

export const decodeSourceSnapshot = Schema.decodeUnknownSync(persistedSource);
