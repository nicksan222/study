import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { materialQuestionInputSchema } from './schemas.ts';

const matching = {
  kind: 'matching' as const,
  prompt: 'Match each cell component to its function.',
  explanation: 'Each component has a distinct function [1].',
  pairs: [
    { term: 'Nucleus', definition: 'Stores DNA' },
    { term: 'Ribosome', definition: 'Builds proteins' },
    { term: 'Mitochondrion', definition: 'Produces ATP' }
  ]
};

testStable(
  'matching requires distinct nonempty terms and definitions and at least two pairs',
  () => {
    const decode = Schema.decodeUnknownSync(materialQuestionInputSchema);

    assert.deepEqual(decode(matching), matching);

    for (const pairs of [
      [],
      matching.pairs.slice(0, 1),
      [matching.pairs[0], matching.pairs[0]],
      [{ term: ' ', definition: 'A' }, matching.pairs[1]],
      [{ term: 'A', definition: ' ' }, matching.pairs[1]],
      [matching.pairs[0], { term: ' nucleus ', definition: 'Other' }],
      [matching.pairs[0], { term: 'Other', definition: ' stores DNA ' }]
    ])
      assert.throws(() => decode({ ...matching, pairs }));
  }
);
