/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks source speech behavior through real persisted application state.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { transcriptDocument } from './audio.ts';

testStable('transcription retains word text and millisecond evidence anchors', () => {
  const result = transcriptDocument({
    text: 'Hello world',
    duration: 2,
    words: [
      { text: 'Hello', start: 0.08, end: 0.4 },
      { text: ' world', start: 0.8, end: 1.2 }
    ]
  });

  expect(result.blocks.map((block) => block.text)).toEqual(['Hello world']);
  expect(result.blocks[0]!.anchor).toEqual({ type: 'time', startMs: 80, endMs: 1200 });
  expect(result.meta.durationMs).toBe(2000);
  expect(result.meta.extractor).toBe('transcription');
});

testStable('transcription rejects empty, nonfinite, reversed and out-of-range timestamps', () => {
  for (const word of [
    { text: '', start: 0, end: 1 },
    { text: 'Hello', start: NaN, end: 1 },
    { text: 'Hello', start: 1, end: 0 },
    { text: 'Hello', start: 0, end: 3 }
  ])
    expect(() => transcriptDocument({ text: 'Hello', duration: 2, words: [word] })).toThrow();

  expect(() => transcriptDocument({ text: '', duration: 2, words: [] })).toThrow();
});
