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
