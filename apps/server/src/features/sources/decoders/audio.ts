/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Converts validated recognizer words into canonical time-anchored evidence.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { plainBlock } from '@study/contracts/sources/document';

import { document } from './common.ts';

export function transcriptDocument(input: {
  text: string;
  duration: number;
  words: readonly { text: string; start: number; end: number }[];
}) {
  if (!Number.isFinite(input.duration) || input.duration <= 0 || !input.words.length)
    throw new StudyError('invalid_input', 'No speech was found in the recording');

  let previousStart = 0;
  const blocks = [];
  let words: string[] = [];
  let start = 0;

  for (const [index, word] of input.words.entries()) {
    validateWord(word, previousStart, input.duration);

    previousStart = word.start;

    if (!words.length) start = word.start;

    words.push(word.text.trim());

    if (endsSegment(word.text, words.length, word.end - start, index === input.words.length - 1)) {
      blocks.push(
        plainBlock('segment', words.join(' '), {
          type: 'time',
          startMs: Math.round(start * 1000),
          endMs: Math.round(word.end * 1000)
        })
      );
      words = [];
    }
  }

  const result = document(blocks, 'transcription', null, 'desert-ant-voz');

  result.meta.durationMs = Math.round(input.duration * 1000);

  return result;
}

function validateWord(
  word: { text: string; start: number; end: number },
  previousStart: number,
  duration: number
) {
  if (
    !word.text.trim() ||
    !Number.isFinite(word.start) ||
    !Number.isFinite(word.end) ||
    word.start < previousStart ||
    word.end < word.start ||
    word.end > duration
  )
    throw new StudyError('invalid_input', 'Invalid transcription timestamps');
}

function endsSegment(text: string, words: number, duration: number, last: boolean) {
  return /[.!?]$/.test(text.trim()) || words >= 40 || duration >= 20 || last;
}
