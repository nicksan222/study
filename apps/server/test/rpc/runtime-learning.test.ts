import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { AuthStore } from '#server/features/auth/store/index';
import { encodeAccount } from '#server/platform/ai/auth/index';
import { ServerContext } from '#server/platform/database/context';
import { transaction } from '#server/platform/definitions/define-store';
import { App, serve } from '#server/runtime/index';

for (const accountState of ['signed-out', 'not-shared'] as const)
  test(
    `an RPC open answer waits durably when ${accountState} and keeps a manual grade`,
    { timeout: 10000 },
    async () => {
      const location = createTestDatabase();

      if (accountState === 'not-shared') {
        const context = new ServerContext(location.open());

        try {
          await Effect.runPromise(
            transaction(context, (tx) =>
              tx.store(AuthStore).saveAccount(
                encodeAccount({
                  subject: 'user',
                  clientId: 'client',
                  refreshToken: 'unused',
                  sharing: false
                })
              )
            )
          );
        } finally {
          context.close();
        }
      }

      const app = await App.open({ path: location.path });
      const server = await serve(app);

      await app.workers.start();

      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
              const project = yield* client['projects.createProject']({ name: 'Quiz' });
              const material = yield* client['materials.create']({
                projectId: project.id,
                title: 'Biology',
                content: {
                  kind: 'quiz',
                  questions: [
                    {
                      kind: 'open',
                      prompt: 'What produces ATP?',
                      explanation: 'Cellular respiration',
                      referenceAnswer: 'Mitochondria'
                    }
                  ]
                }
              });
              const attempt = yield* client['learning.startQuiz']({
                versionId: material.version.id
              });
              const questionId = attempt.questions[0]!.id;

              yield* client['learning.answerQuestion']({
                attemptId: attempt.id,
                questionId,
                answer: { type: 'open', answer: 'Mitochondria' }
              });
              let waiting = false;

              for (let count = 0; count < 100; count++) {
                if (
                  app.store.db.orm.all(sql`SELECT * FROM workflow_configuration_waits`).length === 1
                ) {
                  waiting = true;
                  break;
                }

                yield* Effect.sleep('50 millis');
              }

              assert.ok(waiting, 'grading should wait durably for model setup');
              assert.equal(app.store.db.orm.all(sql`SELECT * FROM workflow_clocks`).length, 0);
              yield* client['learning.gradeResponse']({
                attemptId: attempt.id,
                questionId,
                score: 1,
                feedback: 'Reviewed manually'
              });
              const completed = yield* client['learning.finishQuiz']({ attemptId: attempt.id });

              assert.equal(completed.status, 'completed');
              assert.equal(completed.questions[0]?.score, 1);
              assert.equal(completed.questions[0]?.feedback, 'Reviewed manually');
            })
          )
        );
      } finally {
        await server.close();
        await app.close();
        location.cleanup();
      }
    }
  );
