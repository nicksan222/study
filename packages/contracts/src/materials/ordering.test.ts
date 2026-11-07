import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { quizAnswerSchema } from '../learning/schemas.ts';
import { materialQuestionInputSchema } from './schemas.ts';

const question = {
  kind: 'ordering' as const,
  prompt: 'Order the stages of the water cycle.',
  explanation: 'Water evaporates, condenses, then precipitates. [1]',
  items: [{ text: 'Evaporation' }, { text: 'Condensation' }, { text: 'Precipitation' }]
};

testStable('ordering requires distinct nonempty steps in canonical order', () => {
  const decode = Schema.decodeUnknownSync(materialQuestionInputSchema);

  assert.deepEqual(decode(question), question);

  for (const items of [
    [],
    [{ text: 'One' }],
    [{ text: 'Same' }, { text: 'Same' }],
    [{ text: ' ' }, { text: 'Two' }]
  ])
    assert.throws(() => decode({ ...question, items }));
});

testStable('ordering answers use unique positive branded item IDs', () => {
  const decode = Schema.decodeUnknownSync(quizAnswerSchema);
  const answer = decode({ type: 'ordering', itemIds: [3n, 1n, 2n] });

  assert.ok(answer.type === 'ordering');
  assert.deepEqual(answer.itemIds.map(String), ['3', '1', '2']);

  for (const itemIds of [[], [1n, 1n], [0n, 2n], [-1n, 2n]])
    assert.throws(() => decode({ type: 'ordering', itemIds }));
});
