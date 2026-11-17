import { StudyRpc, defaultQuizSettings } from '@study/contracts';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { serve } from '#server/runtime/index';

test.server.stable(
  'immediate feedback exposes the canonical review only for submitted questions',
  async ({ resources, assert: assertions }) => {
    const assert: test.Assert = assertions;
    const app = await resources.openApp({ path: resources.path });
    const server = await serve(app);

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const material = yield* client['materials.create']({
              title: 'Answer privacy',
              content: {
                kind: 'quiz',
                questions: [
                  {
                    kind: 'true_false',
                    prompt: 'Two is prime.',
                    isTrue: true,
                    explanation: 'Two has two divisors.'
                  },
                  {
                    kind: 'true_false',
                    prompt: 'Four is prime.',
                    isTrue: false,
                    explanation: 'Four has three divisors.'
                  }
                ]
              }
            });
            const attempt = yield* client['learning.startQuiz']({
              versionId: material.version.id,
              configuration: {
                ...defaultQuizSettings,
                feedbackTiming: 'immediate',
                shuffleChoices: false
              }
            });

            assert.deepEqual(attempt.results, []);
            const question = attempt.questions[0]!;

            assert.ok(question.kind === 'true_false');
            const answered = yield* client['learning.answerQuestion']({
              attemptId: attempt.id,
              questionId: question.id,
              answer: {
                type: 'choice',
                choiceIds: [question.choices.find((choice) => choice.text === 'false')!.id]
              }
            });

            assert.equal(answered.results?.length, 1);
            const result = answered.results![0]!;

            assert.equal(result.id, question.id);
            assert.equal(result.score, 0);
            assert.equal(result.explanation, 'Two has two divisors.');
            assert.ok(result.kind === 'true_false');
            assert.equal(result.choices.find((choice) => choice.isCorrect)?.text, 'true');
            assert.ok(!('explanation' in answered.questions[1]!));
            assert.deepEqual(
              yield* client['learning.attempt']({ attemptId: attempt.id }),
              answered
            );
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      await resources.close();
    }
  }
);
