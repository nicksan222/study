import { test } from '@study/testing';
import { Schema } from 'effect';

import { quizAnswerSchema } from '../learning/schemas.ts';
import { materialQuestionInputSchema } from './schemas.ts';

const question = {
  kind: 'ordering' as const,
  prompt: 'Order the stages of the water cycle.',
  explanation: 'Water evaporates, condenses, then precipitates. [1]',
  items: [{ text: 'Evaporation' }, { text: 'Condensation' }, { text: 'Precipitation' }]
};

test.stable('ordering requires distinct nonempty steps in canonical order', () => {
  const decode = Schema.decodeUnknownSync(materialQuestionInputSchema);

  test.assert.deepEqual(decode(question), question);

  for (const items of [
    [],
    [{ text: 'One' }],
    [{ text: 'Same' }, { text: 'Same' }],
    [{ text: ' ' }, { text: 'Two' }]
  ])
    test.assert.throws(() => decode({ ...question, items }));
});

test.stable('ordering answers use unique positive branded item IDs', () => {
  const decode = Schema.decodeUnknownSync(quizAnswerSchema);
  const answer = decode({ type: 'ordering', itemIds: [3n, 1n, 2n] });

  test.assert.ok(answer.type === 'ordering');
  test.assert.deepEqual(answer.itemIds.map(String), ['3', '1', '2']);

  for (const itemIds of [[], [1n, 1n], [0n, 2n], [-1n, 2n]])
    test.assert.throws(() => decode({ type: 'ordering', itemIds }));
});
