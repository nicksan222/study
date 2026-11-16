import { test } from '@study/testing';
import { Schema } from 'effect';

import { materialQuestionInputSchema } from './schemas.ts';

const question = {
  kind: 'fill_blank' as const,
  prompt: 'The powerhouse of the cell is the ____.',
  referenceAnswer: 'mitochondrion',
  explanation: 'Mitochondria produce ATP.'
};

test.stable('fill-in-the-blank questions require exactly one blank and a reference answer', () => {
  const decode = Schema.decodeUnknownSync(materialQuestionInputSchema);

  test.assert.deepEqual(decode(question), question);
  test.assert.doesNotThrow(() =>
    decode({ ...question, prompt: 'The keyword defining my_function is ____.' })
  );

  for (const prompt of ['No blank here.', '____ and ____', '_____', '___'])
    test.assert.throws(() => decode({ ...question, prompt }));

  test.assert.throws(() => decode({ ...question, referenceAnswer: ' ' }));
});
