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

import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { runSpeechInference } from './inference.ts';
import { speechFailureSchema } from './protocol.ts';

const samples = new Float32Array(160);

testStable('only model loading failures wait for speech configuration', async () => {
  expect(
    await runSpeechInference(async () => {
      throw new Error('load failed');
    }, samples)
  ).toEqual({ error: 'model_unavailable' });
});

testStable('speech inference and malformed output failures are terminal', async () => {
  expect(Schema.is(speechFailureSchema)({ error: 'internal' })).toBe(true);

  expect(
    await runSpeechInference(
      async () => ({
        transcribe: async () => {
          throw new Error('inference failed');
        }
      }),
      samples
    )
  ).toEqual({ error: 'internal' });
  expect(
    await runSpeechInference(
      async () => ({
        transcribe: async () => ({ text: 'invalid result' })
      }),
      samples
    )
  ).toEqual({ error: 'internal' });
});
