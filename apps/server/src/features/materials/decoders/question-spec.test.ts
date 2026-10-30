import assert from 'node:assert/strict';
import { test } from 'node:test';

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

test('a captured question specification enforces count and selected kind', () => {
  assert.doesNotThrow(() =>
    assertQuestionSpec({ count: 1, kind: 'open' }, { kind: 'quiz', questions: [open] })
  );
  assert.doesNotThrow(() =>
    assertQuestionSpec({ count: 1, kind: 'choice' }, { kind: 'quiz', questions: [choice] })
  );
  assert.throws(() =>
    assertQuestionSpec({ count: 1, kind: 'open' }, { kind: 'quiz', questions: [choice] })
  );
  assert.throws(() =>
    assertQuestionSpec({ count: 1, kind: 'choice' }, { kind: 'quiz', questions: [open] })
  );
  assert.throws(() =>
    assertQuestionSpec({ count: 1, kind: 'open' }, { kind: 'quiz', questions: [open, open] })
  );
});
