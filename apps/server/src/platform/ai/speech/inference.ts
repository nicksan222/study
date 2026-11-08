/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Separates speech model availability from terminal inference failures.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Schema } from 'effect';

import { transcriptSchema } from './protocol.ts';

/** Keep unavailable models resumable while malformed inference results fail terminally. */
export async function runSpeechInference(
  load: () => Promise<{ transcribe(samples: Float32Array): Promise<unknown> }>,
  samples: Float32Array
) {
  let model: Awaited<ReturnType<typeof load>>;

  try {
    model = await load();
  } catch {
    return { error: 'model_unavailable' } as const;
  }

  try {
    return Schema.decodeUnknownSync(transcriptSchema)(await model.transcribe(samples));
  } catch {
    return { error: 'internal' } as const;
  }
}
