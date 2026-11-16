import { test } from '@study/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies captured question specifications enforce the requested question count and │
 * │ selected question kind.                                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks captured specifications at the decoder boundary without invoking generation.    │
 * │ - Covers malformed and boundary values without invoking provider behavior.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite exercises the decoder boundary directly; it does not depend on database or     │
 * │ provider behavior.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { assertQuestionSpec } from './question-spec.ts';

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

test.stable('a captured question specification enforces count and selected kind', () => {
  test
    .expect(() =>
      assertQuestionSpec({ count: 1, kind: 'open' }, { kind: 'quiz', questions: [open] })
    )
    .not.toThrow();
  test
    .expect(() =>
      assertQuestionSpec({ count: 1, kind: 'choice' }, { kind: 'quiz', questions: [choice] })
    )
    .not.toThrow();
  test.assert.throws(() =>
    assertQuestionSpec({ count: 1, kind: 'open' }, { kind: 'quiz', questions: [choice] })
  );
  test.assert.throws(() =>
    assertQuestionSpec({ count: 1, kind: 'choice' }, { kind: 'quiz', questions: [open] })
  );
  test.assert.throws(() =>
    assertQuestionSpec({ count: 1, kind: 'open' }, { kind: 'quiz', questions: [open, open] })
  );
});
