/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies generated quiz settings against every question and choice count.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks exact counts and allowed generated question kinds.                              │
 * │ - Checks every choice question uses the requested options count.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ These decoder tests use canonical material inputs without invoking persistence.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialContentInput } from '@study/contracts/materials/schemas';
import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { assertQuizConfig } from './question-spec.ts';

const open = { kind: 'open' as const, prompt: 'Q', explanation: 'E', referenceAnswer: 'A' };

const choice = {
  kind: 'single_choice' as const,
  prompt: 'Q',
  explanation: 'E',
  choices: [
    { text: 'A', isCorrect: true },
    { text: 'B', isCorrect: false }
  ]
};

const config = {
  questionCount: 2,
  choiceCount: 2,
  questionKind: 'mixed' as const,
  difficulty: 'balanced' as const
};

const quiz = (
  questions: Extract<MaterialContentInput, { kind: 'quiz' }>['questions']
): MaterialContentInput => ({ kind: 'quiz', questions });

testStable('generation validates exact counts and every question kind and choice count', () => {
  assert.doesNotThrow(() => assertQuizConfig(config, quiz([open, choice])));
  assert.doesNotThrow(() =>
    assertQuizConfig({ ...config, questionKind: 'open' }, quiz([open, open]))
  );
  assert.doesNotThrow(() =>
    assertQuizConfig(
      { ...config, questionKind: 'choice' },
      quiz([choice, { ...choice, kind: 'multiple_choice' }])
    )
  );
  assert.throws(() => assertQuizConfig(config, quiz([open])));
  assert.throws(() =>
    assertQuizConfig(config, { kind: 'flashcards', cards: [{ front: 'Q', back: 'A' }] })
  );
  assert.throws(() => assertQuizConfig({ ...config, questionKind: 'open' }, quiz([open, choice])));
  assert.throws(() =>
    assertQuizConfig({ ...config, questionKind: 'choice' }, quiz([choice, open]))
  );
  assert.throws(() =>
    assertQuizConfig(
      config,
      quiz([choice, { ...choice, choices: [...choice.choices, { text: 'C', isCorrect: false }] }])
    )
  );
  assert.doesNotThrow(() => assertQuizConfig(undefined, quiz([choice])));
});
