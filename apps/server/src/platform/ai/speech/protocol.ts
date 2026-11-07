/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Schema checked boundaries for the isolated offline speech worker.                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { ErrorKind } from '@study/contracts/errors';
import { Schema } from 'effect';

const seconds = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

export const speechInputSchema = Schema.Struct({
  directory: Schema.String,
  bytes: Schema.Uint8Array
});

export const transcriptSchema = Schema.Struct({
  text: Schema.String,
  duration: seconds,
  words: Schema.Array(Schema.Struct({ text: Schema.String, start: seconds, end: seconds }))
});

// The subset is schema checked without a runtime workspace import in the packaged worker.
export const speechFailureSchema = Schema.Struct({
  error: Schema.Literals(['invalid_input', 'model_unavailable'] satisfies readonly ErrorKind[])
});
