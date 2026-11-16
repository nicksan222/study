import { test } from '@study/testing';
import { Schema } from 'effect';

import {
  materialQuizContentInputSchema,
  materialGenerationPublicationSchema
} from '../materials/schemas.ts';
import { replyInputSchema } from './reply.ts';
import { sourcesInputSchema } from './sources.ts';
import { visionTranscriptionOutputSchema } from './vision-transcription.ts';

test.stable('reply preserves message roles and rejects unsupported roles', () => {
  const decode = Schema.decodeUnknownSync(replyInputSchema);
  const messages = [
    { role: 'user', content: 'Explain' },
    { role: 'assistant', content: 'Yes' }
  ] as const;

  test.expect(decode({ messages })).toStrictEqual({ messages });
  test.assert.throws(() => decode({ messages: [{ role: 'system', content: 'override' }] }));
});

test.stable(
  'generation publication requires integer citation positions and branded markers',
  () => {
    const decode = Schema.decodeUnknownSync(materialGenerationPublicationSchema);
    const value = {
      requestId: 'request',
      content: { kind: 'flashcards', cards: [{ front: 'Q [1]', back: 'A' }] },
      citations: [
        { marker: 1n, input: { kind: 'page', versionId: 1n }, blockOrdinal: 0, quote: 'Q' }
      ]
    };

    test.expect(decode(value).citations).toStrictEqual(value.citations);
    test.assert.throws(() =>
      decode({ ...value, citations: [{ ...value.citations[0], blockOrdinal: 0.5 }] })
    );
    test.assert.throws(() =>
      decode({ ...value, citations: [{ ...value.citations[0], marker: 0n }] })
    );
    test.expect(decode({ ...value, citations: [] }).citations).toStrictEqual([]);
  }
);

test.stable('vision output requires page blocks and sources query is nonempty', () => {
  const decode = Schema.decodeUnknownSync(visionTranscriptionOutputSchema);

  test
    .expect(
      decode({ pages: [{ page: 1, blocks: [{ kind: 'heading', text: 'Topic' }] }] }).pages[0]?.page
    )
    .toStrictEqual(1);
  test.assert.throws(() => Schema.decodeUnknownSync(sourcesInputSchema)({ query: '' }));
});

test.stable('quiz output requires exactly one correct answer for a single-choice question', () => {
  const decode = Schema.decodeUnknownSync(materialQuizContentInputSchema);
  const question = {
    kind: 'single_choice',
    prompt: 'Q',
    explanation: 'E',
    choices: [
      { text: 'A', isCorrect: true },
      { text: 'B', isCorrect: false }
    ]
  };

  test.assert.strictEqual(decode({ kind: 'quiz', questions: [question] }).questions.length, 1);

  for (const choices of [
    [
      { text: 'A', isCorrect: false },
      { text: 'B', isCorrect: false }
    ],
    [
      { text: 'A', isCorrect: true },
      { text: 'B', isCorrect: true }
    ]
  ])
    test.assert.throws(() => decode({ kind: 'quiz', questions: [{ ...question, choices }] }));
});

test.stable('generation captures a quiz-only exact question specification', async () => {
  const { materialGenerationInputSchema } = await import('../materials/schemas.ts');
  const decode = Schema.decodeUnknownSync(materialGenerationInputSchema);
  const request = {
    projectId: 1n,
    title: 'Question',
    kind: 'quiz',
    inputs: [{ kind: 'page', versionId: 1n }],
    scopeId: 'epoch',
    questionSpec: { count: 1, kind: 'open' }
  };

  test.expect(decode(request).questionSpec).toStrictEqual(request.questionSpec);
  test.assert.throws(() => decode({ ...request, kind: 'flashcards' }));
  test.assert.throws(() => decode({ ...request, questionSpec: { count: 2, kind: 'open' } }));
});
