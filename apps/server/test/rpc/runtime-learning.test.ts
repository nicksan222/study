import { StudyRpc } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises open-answer grading over RPC while signed out or with sharing disabled.  │
 * │ The grading workflow waits durably, and a manual grade remains authoritative when the    │
 * │ quiz is finished.                                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: an RPC open answer waits durably when <accountState> and keeps a manual       │
 * │   grade.                                                                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/features/auth/store/index,                            │
 * │ #server/platform/ai/auth/index with real SQLite and application resources; fixture       │
 * │ cleanup closes owned resources.                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { AuthStore } from '#server/features/auth/store/index';
import { encodeAccount } from '#server/platform/ai/auth/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { serve } from '#server/runtime/index';

for (const accountState of ['signed-out', 'not-shared'] as const)
  test.stable(
    `an RPC open answer waits durably when ${accountState} and keeps a manual grade`,
    { timeout: 10000 },
    async ({ resources: location, pollUntil, assert: assertions }) => {
      const assert: test.Assert = assertions;

      if (accountState === 'not-shared') {
        const context = new ServerContext(await location.openDb());

        try {
          await Effect.runPromise(
            transaction((tx) =>
              tx.store(AuthStore).saveAccount(
                encodeAccount({
                  subject: 'user',
                  clientId: 'client',
                  refreshToken: 'unused',
                  sharing: false
                })
              )
            ).pipe(Effect.provideService(Database, { store: context }))
          );
        } finally {
          context.close();
        }
      }

      const app = await location.openApp({ path: location.path });
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
              yield* pollUntil(
                Effect.sync(
                  () =>
                    app.store.db.orm.all(sql`SELECT * FROM workflow_configuration_waits`).length ===
                    1
                ),
                (value) => value,
                {
                  attempts: 100,
                  interval: '50 millis',
                  message: 'grading should wait durably for model setup'
                }
              );
              yield* client['learning.gradeResponse']({
                attemptId: attempt.id,
                questionId,
                score: 1,
                feedback: 'Reviewed manually'
              });
              const completed = yield* client['learning.finishQuiz']({ attemptId: attempt.id });

              assert.ok(completed.status === 'completed');
              assert.strictEqual(completed.questions[0]?.score, 1);
              assert.ok(completed.questions[0]?.feedback === 'Reviewed manually');
            })
          )
        );
      } finally {
        await server.close();
        await app.close();
        await location.close();
      }
    }
  );
