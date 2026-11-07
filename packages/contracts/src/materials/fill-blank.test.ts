import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { materialQuestionInputSchema } from './schemas.ts';

const question = {
  kind: 'fill_blank' as const,
  prompt: 'The powerhouse of the cell is the ____.',
  referenceAnswer: 'mitochondrion',
  explanation: 'Mitochondria produce ATP.'
};

testStable('fill-in-the-blank questions require exactly one blank and a reference answer', () => {
  const decode = Schema.decodeUnknownSync(materialQuestionInputSchema);

  assert.deepEqual(decode(question), question);
  assert.doesNotThrow(() =>
    decode({ ...question, prompt: 'The keyword defining my_function is ____.' })
  );

  for (const prompt of ['No blank here.', '____ and ____', '_____', '___'])
    assert.throws(() => decode({ ...question, prompt }));

  assert.throws(() => decode({ ...question, referenceAnswer: ' ' }));
});
