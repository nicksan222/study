import { test } from '@study/testing';
import { Schema } from 'effect';

import { materialQuestionInputSchema } from './schemas.ts';

const question = {
  kind: 'fill_blank' as const,
  prompt: 'The powerhouse of the cell is the ____.',
  referenceAnswer: 'mitochondrion',
  explanation: 'Mitochondria produce ATP.'
};

test.stable(
  'fill-in-the-blank questions require exactly one blank and a reference answer',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const decode = Schema.decodeUnknownSync(materialQuestionInputSchema);

    assert.deepEqual(decode(question), question);
    assert.doesNotThrow(() =>
      decode({ ...question, prompt: 'The keyword defining my_function is ____.' })
    );

    for (const prompt of ['No blank here.', '____ and ____', '_____', '___'])
      assert.throws(() => decode({ ...question, prompt }));

    assert.throws(() => decode({ ...question, referenceAnswer: ' ' }));
  }
);
