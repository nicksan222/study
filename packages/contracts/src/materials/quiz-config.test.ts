import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import {
  materialGenerationInputSchema,
  titledQuizGenerationOutputSchema,
  titledFlashcardsGenerationOutputSchema,
  titledDiagramGenerationOutputSchema
} from './schemas.ts';

testStable(
  'quiz generation settings are bounded, quiz-only and separate from slot specifications',
  () => {
    const decode = Schema.decodeUnknownSync(materialGenerationInputSchema);
    const quizConfig = {
      questionCount: 5,
      choiceCount: 4,
      questionKind: 'mixed',
      difficulty: 'balanced'
    };
    const request = {
      projectId: 1n,
      title: 'Quiz',
      kind: 'quiz',
      inputs: [{ kind: 'document', versionId: 1n }],
      quizConfig
    };

    expect(decode(request).quizConfig).toStrictEqual(quizConfig);

    for (const change of [
      { questionCount: 0 },
      { questionCount: 11 },
      { questionCount: 1.5 },
      { choiceCount: 1 },
      { choiceCount: 7 },
      { choiceCount: 2.5 },
      { questionKind: 'unknown' },
      { difficulty: 'unknown' }
    ])
      assert.throws(() => decode({ ...request, quizConfig: { ...quizConfig, ...change } }));

    assert.throws(() => decode({ ...request, kind: 'flashcards' }));
    assert.throws(() => decode({ ...request, questionSpec: { count: 1, kind: 'open' } }));
  }
);

testStable(
  'automatic titles retain explicit request titles and require bounded generated output titles',
  () => {
    const decode = Schema.decodeUnknownSync(materialGenerationInputSchema);
    const request = {
      projectId: 1n,
      title: 'New quiz',
      autoTitle: true,
      kind: 'quiz',
      inputs: [{ kind: 'document', versionId: 1n }]
    };

    assert.strictEqual(decode(request).autoTitle, true);
    assert.throws(() => decode({ ...request, title: undefined }));
    assert.throws(() => decode({ ...request, autoTitle: 1 }));

    for (const [schema, content] of [
      [
        titledQuizGenerationOutputSchema,
        {
          kind: 'quiz',
          questions: [{ kind: 'open', prompt: 'Q', explanation: 'E', referenceAnswer: 'A' }]
        }
      ],
      [
        titledFlashcardsGenerationOutputSchema,
        { kind: 'flashcards', cards: [{ front: 'Q', back: 'A' }] }
      ],
      [
        titledDiagramGenerationOutputSchema,
        { kind: 'diagram', format: 'mermaid', payload: 'flowchart TD; A-->B' }
      ]
    ] as const) {
      const output = Schema.decodeUnknownSync(schema);

      assert.strictEqual(
        output({ title: 'Cellular respiration', content }).title,
        'Cellular respiration'
      );

      for (const title of [undefined, '', ' ', 'x'.repeat(201)])
        assert.throws(() => output({ title, content }));
    }
  }
);
