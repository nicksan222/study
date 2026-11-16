import type { MaterialContentInput } from '@study/contracts';
import { test } from '@study/testing';

import { duplicateMaterialItems, materialNoveltyItems } from './generation-novelty.ts';

test.unit.stable(
  'detects repeated questions across history and within a new quiz despite citations and typography',
  ({ expect }) => {
    const quiz: MaterialContentInput = {
      kind: 'quiz',
      questions: [
        {
          kind: 'open',
          prompt: 'What is ATP? [1]',
          explanation: 'Evidence [1]',
          referenceAnswer: 'Energy'
        },
        {
          kind: 'open',
          prompt: 'What powers cells?',
          explanation: 'Evidence [1]',
          referenceAnswer: 'ATP'
        },
        {
          kind: 'open',
          prompt: 'What powers cells?! [2]',
          explanation: 'Evidence [2]',
          referenceAnswer: 'ATP'
        }
      ]
    };

    expect(
      duplicateMaterialItems(quiz, [{ prompt: 'Ｗｈａｔ is ATP?! [12]', key: 'What is ATP' }])
    ).toEqual([0, 2]);
  }
);

test.unit.stable(
  'reordered matching and ordering data repeat, but generic prompts with different content do not',
  ({ expect }) => {
    const content: MaterialContentInput = {
      kind: 'quiz',
      questions: [
        {
          kind: 'ordering',
          prompt: 'Order the stages',
          explanation: 'Evidence [1]',
          items: [{ text: 'Sowing' }, { text: 'Harvest' }]
        },
        {
          kind: 'ordering',
          prompt: 'Order the stages',
          explanation: 'Evidence [1]',
          items: [{ text: 'Winter' }, { text: 'Spring' }]
        },
        {
          kind: 'ordering',
          prompt: 'Order the stages [2]',
          explanation: 'Evidence [2]',
          items: [{ text: 'Harvest' }, { text: 'Sowing' }]
        }
      ]
    };

    expect(duplicateMaterialItems(content, [])).toEqual([2]);
  }
);

test.unit.stable(
  'flashcards compare their learning prompt and keep distinct prompts',
  ({ expect }) => {
    const cards: MaterialContentInput = {
      kind: 'flashcards',
      cards: [
        { front: 'ATP [1]', back: 'Energy molecule' },
        { front: '  ATP? [2]', back: 'Changed explanation' },
        { front: 'ADP [1]', back: 'Another molecule' }
      ]
    };

    expect(duplicateMaterialItems(cards, [])).toEqual([1]);
    expect(materialNoveltyItems(cards).map(({ prompt }) => prompt)).toEqual([
      'ATP [1]',
      '  ATP? [2]',
      'ADP [1]'
    ]);
  }
);

test.unit.stable(
  'different mathematical relations do not become exact duplicates',
  ({ expect }) => {
    expect(
      duplicateMaterialItems(
        {
          kind: 'flashcards',
          cards: [
            { front: 'Solve x + 2 = 4', back: '2' },
            { front: 'Solve x - 2 = 4', back: '6' },
            { front: 'When is x > 2?', back: 'A relation' },
            { front: 'When is x < 2?', back: 'Another relation' },
            { front: 'Evaluate 5!', back: '120' },
            { front: 'Evaluate 5', back: '5' },
            { front: 'Define f(x)', back: 'A function' },
            { front: 'Define f′(x)', back: 'A derivative' },
            { front: 'When is x != 2?', back: 'Not equal' },
            { front: 'When is x = 2?', back: 'Equal' },
            { front: 'Define F(x)', back: 'A different function from f(x)' }
          ]
        },
        []
      )
    ).toEqual([]);
  }
);
