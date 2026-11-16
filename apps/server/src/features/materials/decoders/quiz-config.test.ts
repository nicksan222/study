import type { MaterialContentInput } from '@study/contracts';
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
import { test } from '@study/testing';

import { assertQuizConfig, assertQuestionSpec } from './question-spec.ts';

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

test.stable('generation validates exact counts and every question kind and choice count', () => {
  test.assert.doesNotThrow(() => assertQuizConfig(config, quiz([open, choice])));
  test.assert.doesNotThrow(() =>
    assertQuizConfig({ ...config, questionKind: 'open' }, quiz([open, open]))
  );
  test.assert.doesNotThrow(() =>
    assertQuizConfig(
      { ...config, questionKind: 'choice' },
      quiz([choice, { ...choice, kind: 'multiple_choice' }])
    )
  );
  test.assert.throws(() => assertQuizConfig(config, quiz([open])));
  test.assert.throws(() =>
    assertQuizConfig(config, { kind: 'flashcards', cards: [{ front: 'Q', back: 'A' }] })
  );
  test.assert.throws(() =>
    assertQuizConfig({ ...config, questionKind: 'open' }, quiz([open, choice]))
  );
  test.assert.throws(() =>
    assertQuizConfig({ ...config, questionKind: 'choice' }, quiz([choice, open]))
  );
  test.assert.throws(() =>
    assertQuizConfig(
      config,
      quiz([choice, { ...choice, choices: [...choice.choices, { text: 'C', isCorrect: false }] }])
    )
  );
  test.assert.doesNotThrow(() => assertQuizConfig(undefined, quiz([choice])));
});

test.stable('blank-only generation rejects other kinds and ignores the choice count', () => {
  const blank = { ...open, kind: 'fill_blank' as const, prompt: 'A prime has ____ divisors.' };
  const blanks = { ...config, questionKind: 'fill_blank' as const };

  test.assert.doesNotThrow(() => assertQuizConfig(blanks, quiz([blank, blank])));
  test.assert.doesNotThrow(() => assertQuizConfig(config, quiz([blank, choice])));
  test.assert.throws(() => assertQuizConfig(blanks, quiz([blank, open])));
  test.assert.throws(() =>
    assertQuizConfig({ ...config, questionKind: 'open' }, quiz([blank, open]))
  );
  test.assert.throws(() =>
    assertQuizConfig({ ...config, questionKind: 'choice' }, quiz([blank, choice]))
  );
});

test.stable('ordering-only generation enforces exact kind and count without choice options', () => {
  const ordering = {
    kind: 'ordering' as const,
    prompt: 'Order',
    explanation: 'E',
    items: [{ text: 'A' }, { text: 'B' }]
  };
  const settings = { ...config, questionKind: 'ordering' as const };

  test.assert.doesNotThrow(() => assertQuizConfig(settings, quiz([ordering, ordering])));
  test.assert.throws(() => assertQuizConfig(settings, quiz([ordering, open])));
  test.assert.throws(() => assertQuizConfig(settings, quiz([ordering])));
  test.assert.throws(() =>
    assertQuizConfig({ ...config, questionKind: 'choice' }, quiz([ordering, choice]))
  );
});
test.stable(
  'matching-only generation preserves exact question counts and excludes other kinds',
  () => {
    const matching = {
      kind: 'matching' as const,
      prompt: 'Match',
      explanation: 'Evidence [1]',
      pairs: [
        { term: 'A', definition: 'a' },
        { term: 'B', definition: 'b' }
      ]
    };
    const configured = { ...config, questionKind: 'matching' as const };

    test.assert.doesNotThrow(() => assertQuizConfig(configured, quiz([matching, matching])));
    test.assert.throws(() => assertQuizConfig(configured, quiz([matching])));
    test.assert.throws(() => assertQuizConfig(configured, quiz([matching, open])));
    test.assert.throws(() =>
      assertQuizConfig({ ...config, questionKind: 'choice' }, quiz([matching, choice]))
    );
  }
);

test.stable(
  'boolean generation enforces its exact kind and count independently of choice preferences',
  () => {
    const question = {
      kind: 'true_false' as const,
      prompt: 'ATP carries energy.',
      explanation: 'Energy carrier',
      isTrue: true
    };

    test.assert.throws(() => assertQuestionSpec({ count: 1, kind: 'choice' }, quiz([question])));
    test.assert.throws(() => assertQuestionSpec({ count: 1, kind: 'open' }, quiz([question])));
    const booleanConfig = { ...config, questionKind: 'true_false' as const, choiceCount: 6 };

    test.assert.doesNotThrow(() => assertQuizConfig(booleanConfig, quiz([question, question])));
    test.assert.throws(() => assertQuizConfig(booleanConfig, quiz([question])));
    test.assert.throws(() => assertQuizConfig(booleanConfig, quiz([question, choice])));
    test.assert.throws(() =>
      assertQuizConfig({ ...config, questionKind: 'choice' }, quiz([question, question]))
    );
  }
);
