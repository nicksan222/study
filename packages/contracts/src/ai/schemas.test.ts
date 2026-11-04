import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import {
  materialQuizContentInputSchema,
  materialGenerationPublicationSchema
} from '../materials/schemas.ts';
import { replyInputSchema } from './reply.ts';
import { sourcesInputSchema } from './sources.ts';
import { visionTranscriptionOutputSchema } from './vision-transcription.ts';

testStable('reply preserves message roles and rejects unsupported roles', () => {
  const decode = Schema.decodeUnknownSync(replyInputSchema);
  const messages = [
    { role: 'user', content: 'Explain' },
    { role: 'assistant', content: 'Yes' }
  ] as const;

  expect(decode({ messages })).toStrictEqual({ messages });
  assert.throws(() => decode({ messages: [{ role: 'system', content: 'override' }] }));
});

testStable('generation publication requires integer citation positions and branded markers', () => {
  const decode = Schema.decodeUnknownSync(materialGenerationPublicationSchema);
  const value = {
    requestId: 'request',
    content: { kind: 'flashcards', cards: [{ front: 'Q [1]', back: 'A' }] },
    citations: [
      { marker: 1n, input: { kind: 'document', versionId: 1n }, blockOrdinal: 0, quote: 'Q' }
    ]
  };

  expect(decode(value).citations).toStrictEqual(value.citations);
  assert.throws(() =>
    decode({ ...value, citations: [{ ...value.citations[0], blockOrdinal: 0.5 }] })
  );
  assert.throws(() => decode({ ...value, citations: [{ ...value.citations[0], marker: 0n }] }));
  expect(decode({ ...value, citations: [] }).citations).toStrictEqual([]);
});

testStable('vision output requires page blocks and sources query is nonempty', () => {
  const decode = Schema.decodeUnknownSync(visionTranscriptionOutputSchema);

  expect(
    decode({ pages: [{ page: 1, blocks: [{ kind: 'heading', text: 'Topic' }] }] }).pages[0]?.page
  ).toStrictEqual(1);
  assert.throws(() => Schema.decodeUnknownSync(sourcesInputSchema)({ query: '' }));
});

testStable('quiz output requires exactly one correct answer for a single-choice question', () => {
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

  assert.strictEqual(decode({ kind: 'quiz', questions: [question] }).questions.length, 1);

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
    assert.throws(() => decode({ kind: 'quiz', questions: [{ ...question, choices }] }));
});

testStable('generation captures a quiz-only exact question specification', async () => {
  const { materialGenerationInputSchema } = await import('../materials/schemas.ts');
  const decode = Schema.decodeUnknownSync(materialGenerationInputSchema);
  const request = {
    projectId: 1n,
    title: 'Question',
    kind: 'quiz',
    inputs: [{ kind: 'document', versionId: 1n }],
    scopeId: 'epoch',
    questionSpec: { count: 1, kind: 'open' }
  };

  expect(decode(request).questionSpec).toStrictEqual(request.questionSpec);
  assert.throws(() => decode({ ...request, kind: 'flashcards' }));
  assert.throws(() => decode({ ...request, questionSpec: { count: 2, kind: 'open' } }));
});
