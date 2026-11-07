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

testStable('blank-only generation rejects other kinds and ignores the choice count', () => {
  const blank = { ...open, kind: 'fill_blank' as const, prompt: 'A prime has ____ divisors.' };
  const blanks = { ...config, questionKind: 'fill_blank' as const };

  assert.doesNotThrow(() => assertQuizConfig(blanks, quiz([blank, blank])));
  assert.doesNotThrow(() => assertQuizConfig(config, quiz([blank, choice])));
  assert.throws(() => assertQuizConfig(blanks, quiz([blank, open])));
  assert.throws(() => assertQuizConfig({ ...config, questionKind: 'open' }, quiz([blank, open])));
  assert.throws(() =>
    assertQuizConfig({ ...config, questionKind: 'choice' }, quiz([blank, choice]))
  );
});

testStable(
  'boolean generation enforces its exact kind and count independently of choice preferences',
  () => {
    const question = {
      kind: 'true_false' as const,
      prompt: 'ATP carries energy.',
      explanation: 'Energy carrier',
      isTrue: true
    };
    const booleanConfig = { ...config, questionKind: 'true_false' as const, choiceCount: 6 };

    assert.doesNotThrow(() => assertQuizConfig(booleanConfig, quiz([question, question])));
    assert.throws(() => assertQuizConfig(booleanConfig, quiz([question])));
    assert.throws(() => assertQuizConfig(booleanConfig, quiz([question, choice])));
    assert.throws(() =>
      assertQuizConfig({ ...config, questionKind: 'choice' }, quiz([question, question]))
    );
  }
);
