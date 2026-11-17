import { StudyRpc, defaultQuizSettings } from '@study/contracts';
import { plainBlock } from '@study/contracts';
import { encodeAccount, ServerContext, Database, transaction } from '@study/server';
import { test } from '@study/testing';
import { Effect, Option, Result, Stream } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { AuthStore } from '#server/features/auth/store/index';
import { serve } from '#server/runtime/index';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises HTTP practice generation across normal, invalid-model, archived-request, │
 * │ and exhausted-transient scenarios. It verifies recovery and replenishment stop once the  │
 * │ practice request is no longer eligible.                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: HTTP practice <mode> recovers, replenishes and stops without further provider │
 * │   work.                                                                                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/features/auth/store/index,                            │
 * │ #server/platform/ai/auth/persistence with real SQLite and application resources; fixture │
 * │ cleanup closes owned resources.                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { textResponseEvents, toolResponseEvents } from '#testing/responses';

const isReady = (slot: { status: string }) => slot.status === 'ready';

const isSettled = (slot: { status: string }) => isReady(slot) || slot.status === 'failed';

const isDrained = (execution: { status: string }) =>
  ['completed', 'cancelled'].includes(execution.status);

function auxiliaryGeneration(body: string) {
  if (body.includes('Plan fresh learning coverage'))
    return { focus: ['Explore a fresh evidence-grounded question'] };

  if (body.includes('Review learning exercise novelty')) return { duplicates: [] };

  return undefined;
}

for (const mode of [
  'normal',
  'invalid-model',
  'archived-before-request',
  'transient-exhausted'
] as const)
  test.server.stable(
    `HTTP practice ${mode} recovers, replenishes and stops without further provider work`,
    { timeout: 20000 },
    async ({ resources: resourcesFixture, assert: assertions, expect, pollUntil }) => {
      const assert: test.Assert = assertions;

      const resources = resourcesFixture;
      let generations = 0;
      let providerCalls = 0;
      let refilling = false;
      const refillPlanning = Promise.withResolvers<void>();
      const releaseRefillPlan = Promise.withResolvers<void>();
      let failedCalls = 0;
      let healthyStarts = 0;
      let outputs = 0;
      const startedAt = Date.now();
      const trace: { ms: number; stage: string; status?: number }[] = [];
      const mark = (stage: string, status?: number) => {
        if (trace.length < 64) trace.push({ ms: Date.now() - startedAt, stage, status });
      };
      let invalidResponse = mode === 'invalid-model';
      let transient = mode === 'transient-exhausted';
      const peer = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: async (request) => {
          const body = await request.text();

          if (new URL(request.url).pathname === '/api/accounts/oauth/token') {
            mark('token', 200);

            return Response.json({
              access_token: 'token',
              refresh_token: 'rotated',
              expires_in: 3600
            });
          }

          providerCalls++;

          if (refilling && body.includes('Plan fresh learning coverage')) {
            refillPlanning.resolve();
            await releaseRefillPlan.promise;
          }

          const toolResult = body.includes('function_call_output');
          const open = body.includes('exactly one open question');
          const auxiliary = auxiliaryGeneration(body);
          const candidateStart = !toolResult && !auxiliary;

          mark(toolResult ? 'tool-result' : 'generation', transient ? 503 : 200);

          if (candidateStart) {
            generations++;

            if (!transient) healthyStarts++;
          }

          if (transient && !auxiliary) {
            failedCalls++;

            return Response.json(
              { error: { message: 'busy', type: 'server_error' } },
              { status: 503 }
            );
          }

          const content = practiceContent(open, toolResult ? ++outputs : outputs);
          const events = providerEvents();

          function providerEvents() {
            const call = {
              type: 'function_call',
              id: 'tool-item',
              call_id: 'source-call',
              name: 'sources',
              arguments: '{"query":"alpha"}'
            };
            const invalid = toolResult && invalidResponse;

            if (invalid) invalidResponse = false;

            const events =
              toolResult || auxiliary
                ? textResponseEvents(
                    JSON.stringify(
                      auxiliary ??
                        (invalid
                          ? {
                              ...content,
                              questions: [content.questions[0], content.questions[0]]
                            }
                          : content)
                    )
                  )
                : toolResponseEvents(call);

            return events;
          }

          return new Response(
            events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
              'data: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } }
          );
        }
      });

      resources.dispose(async () => {
        releaseRefillPlan.resolve();
        await peer.stop(true);
      });
      assert.ok(peer.port, 'missing peer address');
      const base = peer.url.origin;
      const context = new ServerContext(await resources.openDb());

      await Effect.runPromise(
        transaction((tx) =>
          tx.store(AuthStore).saveAccount(
            encodeAccount({
              subject: 'practice-user',
              clientId: 'client',
              refreshToken: 'refresh',
              sharing: true
            })
          )
        ).pipe(Effect.provideService(Database, { store: context }))
      );
      context.close();
      const app = await resources.openApp({
        issuer: base,
        fetch: (input, init) => {
          const url = input instanceof Request ? new URL(input.url) : new URL(input);
          const target = `${base}${url.pathname}${url.search}`;

          return fetch(input instanceof Request ? new Request(target, input) : target, init);
        }
      });
      const server = resources.manage(await serve(app));

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const project = yield* client['projects.createProject']({ name: 'Practice' });
            const document = yield* client['pages.create']({
              createKey: crypto.randomUUID(),
              inputs: [],
              citations: [],
              projectId: project.id,
              title: 'Evidence',
              document: {
                blocks: [plainBlock('paragraph', 'alpha evidence', { type: 'authored' })],
                meta: {
                  extractor: null,
                  extractorVersion: 1,
                  provider: null,
                  durationMs: null,
                  pageCount: null,
                  refiners: [],
                  waitingFor: [],
                  corrected: false,
                  omissions: []
                }
              }
            });

            yield* client['settings.saveLlmSettings']({
              tiny: { provider: 1, model: 1 },
              medium: { provider: 1, model: 1 },
              smart: { provider: 1, model: 1 }
            });
            yield* client['settings.saveQuizSettings']({
              ...defaultQuizSettings,
              feedbackTiming: mode === 'normal' ? 'immediate' : 'end',
              questionKind: 'open',
              questionCount: 1
            });
            const initial = yield* client['learning.startPractice']({
              projectId: project.id,
              inputs: [{ kind: 'page', versionId: document.version!.id }]
            });

            assert.strictEqual(initial.slots.length, 2);
            expect(initial.slots.map((slot) => slot.kind)).toStrictEqual(['choice', 'choice']);

            if (mode === 'archived-before-request')
              yield* client['pages.archive']({ id: document.id, archived: true });

            yield* client['system.startWorkers']({});
            const settledPractice = client['learning.practice.live']({
              projectId: project.id
            }).pipe(
              Stream.filter((frame) => frame._tag === 'Snapshot'),
              Stream.map((frame) => Result.getOrThrow(frame.result)),
              Stream.filter((value) => value.slots.every(isSettled)),
              Stream.runHead,
              Effect.map(Option.getOrThrow)
            );
            let ready = yield* settledPractice;

            if (mode === 'archived-before-request')
              yield* client['pages.archive']({ id: document.id, archived: false });

            yield* recoverFailedPractice({ assert });

            function* recoverFailedPractice({
              assert: assertions
            }: Pick<test.server.Context, 'assert'>) {
              const assert: test.Assert = assertions;

              if (mode !== 'normal') {
                mark('recovery');
                transient = false;
                const failed = ready.slots.filter((slot) => slot.status === 'failed');

                assert.strictEqual(failed.length, mode === 'invalid-model' ? 1 : 2);

                if (mode === 'transient-exhausted')
                  assert.strictEqual(failedCalls, 8, JSON.stringify({ healthyStarts, trace }));

                if (mode === 'invalid-model') {
                  const settings = yield* client['settings.appSettings']({});

                  yield* client['settings.saveAppSettings']({ ...settings, language: 2 });
                }

                for (const slot of failed) {
                  mark('manual-retry');
                  const retried = yield* client['learning.retryPracticeQuestion']({
                    slotId: slot.slotId
                  });

                  assert.strictEqual(retried.slotId, slot.slotId);
                  assert.strictEqual(retried.kind, slot.kind);
                  mark('duplicate-manual-retry');
                  yield* client['learning.retryPracticeQuestion']({ slotId: slot.slotId });
                }

                ready = yield* settledPractice;
              }
            }

            assert.ok(
              ready.slots.every(isReady),
              JSON.stringify(
                {
                  ready,
                  generations,
                  trace,
                  executions: app.store.db.orm.all(
                    'SELECT workflow_tag,status,result FROM workflow_executions'
                  )
                },
                (_, value) => (typeof value === 'bigint' ? String(value) : value)
              )
            );

            for (const slot of ready.slots) {
              const attempt = yield* client['learning.attempt']({ attemptId: slot.attemptId! });

              assert.strictEqual(attempt.status, 'in_progress');

              if (attempt.status === 'in_progress') {
                assert.strictEqual(attempt.feedbackTiming, mode === 'normal' ? 'immediate' : 'end');
                assert.strictEqual(attempt.questions.length, 1);
                assert.ok(
                  ['single_choice', 'multiple_choice'].includes(attempt.questions[0]!.kind)
                );
              }
            }

            assert.strictEqual(
              generations,
              mode === 'invalid-model' ? 3 : mode === 'transient-exhausted' ? 10 : 2,
              JSON.stringify({ failedCalls, healthyStarts, trace })
            );

            if (mode === 'transient-exhausted')
              assert.strictEqual(healthyStarts, 2, JSON.stringify({ failedCalls, trace }));

            const first = ready.slots[0]!;

            assert.ok(first.attemptId);
            const attempt = yield* client['learning.attempt']({ attemptId: first.attemptId });
            const question = attempt.questions[0]!;

            assert.ok('choices' in question, 'expected choice');

            const input = {
              slotId: first.slotId,
              answer: { type: 'choice' as const, choiceIds: [question.choices[0]!.id] }
            };

            refilling = true;
            yield* client['learning.answerPracticeQuestion'](input);
            yield* client['learning.answerPracticeQuestion'](input);
            const rejected = yield* Effect.flip(
              client['learning.answerQuestion']({
                attemptId: first.attemptId,
                questionId: question.id,
                answer: { type: 'choice', choiceIds: [question.choices[1]!.id] }
              })
            );

            assert.ok('kind' in rejected);
            assert.ok(rejected.kind === 'invalid_input');
            yield* client['learning.answerPracticeQuestion'](input);
            const refill = yield* client['learning.practice']({ projectId: project.id });

            expect(refill.slots.map((slot) => slot.kind)).toStrictEqual(['choice', 'open']);
            // Stop with a provider response in flight, before the next generation stage can start.
            yield* Effect.promise(() => refillPlanning.promise);
            const stopped = yield* client['learning.stopPractice']({ projectId: project.id });

            assert.ok(stopped.enabled === false);
            assert.strictEqual(stopped.slots.length, 0);
            const count = generations;
            const callsAtStop = providerCalls;

            releaseRefillPlan.resolve();

            yield* client['system.stopWorkers']({});
            yield* client['system.startWorkers']({});
            yield* assertRefillDrained({ pollUntil });

            function* assertRefillDrained({ pollUntil }: Pick<test.server.Context, 'pollUntil'>) {
              const refillSlot = refill.slots.find((slot) => slot.kind === 'open')!;

              yield* pollUntil(
                client['workflows.executions']({ limit: 100, correlationId: refillSlot.slotId }),
                (value) => value.items.length > 0 && value.items.every(isDrained),
                { attempts: 100, interval: '25 millis', message: 'Practice refill did not drain' }
              );
            }

            assert.strictEqual(generations, count);
            assert.strictEqual(providerCalls, callsAtStop);
            assert.strictEqual(yield* client['projects.deleteProject']({ id: project.id }), true);
            expect(app.store.db.orm.all('PRAGMA foreign_key_check')).toStrictEqual([]);
          })
        )
      );
    }
  );

function practiceContent(open: boolean, example: number) {
  return {
    kind: 'quiz',
    questions: [
      open
        ? {
            kind: 'open',
            prompt: `Explain alpha in example ${example} [1]`,
            explanation: 'Alpha is evidence [1]',
            referenceAnswer: 'Alpha evidence'
          }
        : {
            kind: 'single_choice',
            prompt: `Which is evidence in example ${example}? [1]`,
            explanation: 'Alpha [1]',
            choices: [
              { text: 'Alpha', isCorrect: true },
              { text: 'Other', isCorrect: false }
            ]
          }
    ]
  };
}
