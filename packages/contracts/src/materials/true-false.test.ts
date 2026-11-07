import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { materialQuestionInputSchema } from './schemas.ts';

testStable('true or false content requires a boolean truth value', () => {
  const decode = Schema.decodeUnknownSync(materialQuestionInputSchema);
  const question = {
    kind: 'true_false' as const,
    prompt: 'ATP carries energy.',
    explanation: 'ATP is an energy carrier.',
    isTrue: true
  };

  assert.deepEqual(decode(question), question);
  assert.throws(() => decode({ ...question, isTrue: 'true' }));
  assert.throws(() =>
    decode({
      kind: 'true_false' as const,
      prompt: question.prompt,
      explanation: question.explanation,
      choices: [{ text: 'Maybe', isCorrect: true }]
    })
  );
});
