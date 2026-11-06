import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { materialGenerationInputSchema } from './schemas.ts';

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
