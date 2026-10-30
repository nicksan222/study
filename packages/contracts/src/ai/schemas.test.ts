import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { Schema } from 'effect';

import {
  materialQuizContentInputSchema,
  materialGenerationPublicationSchema
} from '../materials/schemas.ts';
import { replyInputSchema } from './reply.ts';
import { sourcesInputSchema } from './sources.ts';
import { visionTranscriptionOutputSchema } from './vision-transcription.ts';

test('reply preserves message roles and rejects unsupported roles', () => {
  const decode = Schema.decodeUnknownSync(replyInputSchema);
  const messages = [
    { role: 'user', content: 'Explain' },
    { role: 'assistant', content: 'Yes' }
  ] as const;

  assert.deepEqual(decode({ messages }), { messages });
  assert.throws(() => decode({ messages: [{ role: 'system', content: 'override' }] }));
});

test('generation publication requires integer citation positions and branded markers', () => {
  const decode = Schema.decodeUnknownSync(materialGenerationPublicationSchema);
  const value = {
    requestId: 'request',
    content: { kind: 'flashcards', cards: [{ front: 'Q [1]', back: 'A' }] },
    citations: [{ marker: 1n, inputVersionId: 1n, blockOrdinal: 0, quote: 'Q' }]
  };

  assert.throws(() =>
    decode({ ...value, citations: [{ ...value.citations[0], blockOrdinal: 0.5 }] })
  );
  assert.throws(() => decode({ ...value, citations: [{ ...value.citations[0], marker: 0n }] }));
  assert.throws(() => decode({ ...value, citations: [] }));
});

test('vision output requires page blocks and sources query is nonempty', () => {
  const decode = Schema.decodeUnknownSync(visionTranscriptionOutputSchema);

  assert.deepEqual(
    decode({ pages: [{ page: 1, blocks: [{ kind: 'heading', text: 'Topic' }] }] }).pages[0]?.page,
    1
  );
  assert.throws(() => Schema.decodeUnknownSync(sourcesInputSchema)({ query: '' }));
});

test('quiz output requires exactly one correct answer for a single-choice question', () => {
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

  assert.equal(decode({ kind: 'quiz', questions: [question] }).questions.length, 1);

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

test('generation captures a quiz-only exact question specification', async () => {
  const { materialGenerationInputSchema } = await import('../materials/schemas.ts');
  const decode = Schema.decodeUnknownSync(materialGenerationInputSchema);
  const request = {
    projectId: 1n,
    title: 'Question',
    kind: 'quiz',
    inputVersionIds: [1n],
    scopeId: 'epoch',
    questionSpec: { count: 1, kind: 'open' }
  };

  assert.deepEqual(decode(request).questionSpec, request.questionSpec);
  assert.throws(() => decode({ ...request, kind: 'flashcards' }));
  assert.throws(() => decode({ ...request, questionSpec: { count: 2, kind: 'open' } }));
});
