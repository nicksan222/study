/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Explicitly installs the pinned model and exercises real inference over a spoken    │
 * │ fixture.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { installModelAssets } from '#server/platform/ai/model-assets';

import { transcribeAudio } from './local.ts';
import { vozModel } from './model.ts';

testStable('real Voz transcribes a spoken lecture with ordered word evidence offline', async () => {
  const directory = resolve('target/speech-model/voz');

  await Effect.runPromise(installModelAssets(directory, vozModel));
  const bytes = await readFile(new URL('./fixtures/lecture.wav', import.meta.url));
  const result = await Effect.runPromise(transcribeAudio(directory, bytes));

  expect(result.text.toLowerCase()).toMatch(/capital of italy is rome/);
  expect(result.words.length).toBeGreaterThan(15);
  expect(result.duration).toBeGreaterThan(5);

  for (const [index, word] of result.words.entries()) {
    expect(word.start).toBeGreaterThanOrEqual(index ? result.words[index - 1]!.start : 0);
    expect(word.end).toBeGreaterThanOrEqual(word.start);
    expect(word.end).toBeLessThanOrEqual(result.duration);
  }
});

testStable(
  'speech inference with an absent installation fails before starting a worker or downloading',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'study-speech-'));

    try {
      const failure = await Effect.runPromise(
        Effect.flip(transcribeAudio(directory, new Uint8Array()))
      );

      expect(failure.kind).toBe('model_unavailable');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
