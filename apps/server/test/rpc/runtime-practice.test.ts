import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { AuthStore } from '#server/features/auth/store/index';
import { encodeAccount } from '#server/platform/ai/auth/persistence';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { serve } from '#server/runtime/index';
import { createStudyTest } from '#testing/server-test';

for (const mode of [
  'normal',
  'invalid-model',
  'archived-before-request',
  'transient-exhausted'
] as const)
  test(
    `HTTP practice ${mode} recovers, replenishes and stops without further provider work`,
    { timeout: 20000 },
    async (t) => {
      const resources = createStudyTest(t, { app: false });
      let generations = 0;
      let failedCalls = 0;
      let healthyStarts = 0;
      const startedAt = Date.now();
      const trace: { ms: number; stage: string; status?: number }[] = [];
      const mark = (stage: string, status?: number) => {
        if (trace.length < 64) trace.push({ ms: Date.now() - startedAt, stage, status });
      };
      let invalidResponse = mode === 'invalid-model';
      let transient = mode === 'transient-exhausted';
      const peer = createServer(async (request, response) => {
        let body = '';

        for await (const chunk of request) body += chunk;

        if (request.url === '/api/accounts/oauth/token') {
          mark('token', 200);
          response.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              access_token: 'token',
              refresh_token: 'rotated',
              expires_in: 3600
            })
          );

          return;
        }

        const toolResult = body.includes('function_call_output');
        const open = body.includes('exactly one open question');

        mark(toolResult ? 'tool-result' : 'generation', transient ? 503 : 200);

        if (!toolResult) generations++;

        if (!transient && !toolResult) healthyStarts++;

        if (transient) {
          failedCalls++;
          response
            .writeHead(503, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: { message: 'busy', type: 'server_error' } }));

          return;
        }

        const content = {
          kind: 'quiz',
          questions: [
            open
              ? {
                  kind: 'open',
                  prompt: 'Explain alpha [1]',
                  explanation: 'Alpha is evidence [1]',
                  referenceAnswer: 'Alpha evidence'
                }
              : {
                  kind: 'single_choice',
                  prompt: 'Which is evidence? [1]',
                  explanation: 'Alpha [1]',
                  choices: [
                    { text: 'Alpha', isCorrect: true },
                    { text: 'Other', isCorrect: false }
                  ]
                }
          ]
        };
        const call = {
          type: 'function_call',
          id: 'tool-item',
          call_id: 'source-call',
          name: 'sources',
          arguments: '{"query":"alpha"}'
        };
        const invalid = toolResult && invalidResponse;

        if (invalid) invalidResponse = false;

        const events = toolResult
          ? [
              {
                type: 'response.output_item.added',
                output_index: 0,
                item: { type: 'message', id: 'answer' }
              },
              {
                type: 'response.output_text.delta',
                item_id: 'answer',
                delta: JSON.stringify(
                  invalid
                    ? { ...content, questions: [content.questions[0], content.questions[0]] }
                    : content
                )
              },
              { type: 'response.completed', response: {} }
            ]
          : [
              { type: 'response.output_item.added', output_index: 0, item: call },
              {
                type: 'response.output_item.done',
                output_index: 0,
                item: { ...call, status: 'completed' }
              },
              { type: 'response.completed', response: {} }
            ];

        response.writeHead(200, { 'content-type': 'text/event-stream' });

        for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);

        response.end('data: [DONE]\n\n');
      });

      await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
      resources.dispose(async () => {
        peer.closeAllConnections();
        await new Promise<void>((resolve) => peer.close(() => resolve()));
      });
      const address = peer.address();

      if (!address || typeof address === 'string') throw new Error('missing peer address');

      const base = `http://127.0.0.1:${address.port}`;
      const context = new ServerContext(resources.openDb());

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
            const document = yield* client['materials.create']({
              projectId: project.id,
              title: 'Evidence',
              content: {
                kind: 'document',
                blocks: [
                  { kind: 'paragraph', text: 'alpha evidence', anchor: { type: 'page', page: 1 } }
                ],
                meta: {
                  extractor: null,
                  extractorVersion: 1,
                  provider: null,
                  durationMs: null,
                  pageCount: null,
                  refiners: [],
                  waitingFor: [],
                  corrected: false
                }
              }
            });

            yield* client['settings.saveLlmSettings']({
              tiny: { provider: 1, model: 1 },
              medium: { provider: 1, model: 1 },
              smart: { provider: 1, model: 1 }
            });
            const initial = yield* client['learning.startPractice']({
              projectId: project.id,
              inputVersionIds: [document.version.id]
            });

            assert.equal(initial.slots.length, 2);
            assert.deepEqual(
              initial.slots.map((slot) => slot.kind),
              ['choice', 'choice']
            );

            if (mode === 'archived-before-request')
              yield* client['materials.archive']({ id: document.id });

            yield* client['system.startWorkers']({});
            let ready = initial;

            for (let i = 0; i < (mode === 'transient-exhausted' ? 500 : 150); i++) {
              ready = yield* client['learning.practice']({ projectId: project.id });

              if (ready.slots.every((slot) => slot.status === 'ready' || slot.status === 'failed'))
                break;

              yield* Effect.sleep('25 millis');
            }

            if (mode === 'archived-before-request')
              yield* client['materials.unarchive']({ id: document.id });

            if (mode !== 'normal') {
              mark('recovery');
              transient = false;
              const failed = ready.slots.filter((slot) => slot.status === 'failed');

              assert.equal(failed.length, mode === 'invalid-model' ? 1 : 2);

              if (mode === 'transient-exhausted')
                assert.equal(failedCalls, 8, JSON.stringify({ healthyStarts, trace }));

              if (mode === 'invalid-model') {
                const settings = yield* client['settings.appSettings']({});

                yield* client['settings.saveAppSettings']({ ...settings, language: 2 });
              }

              for (const slot of failed) {
                mark('manual-retry');
                const retried = yield* client['learning.retryPracticeQuestion']({
                  slotId: slot.slotId
                });

                assert.equal(retried.slotId, slot.slotId);
                assert.equal(retried.kind, slot.kind);
                mark('duplicate-manual-retry');
                yield* client['learning.retryPracticeQuestion']({ slotId: slot.slotId });
              }

              for (let i = 0; i < 150; i++) {
                ready = yield* client['learning.practice']({ projectId: project.id });

                if (ready.slots.every((slot) => slot.status === 'ready')) break;

                yield* Effect.sleep('25 millis');
              }
            }

            assert.ok(
              ready.slots.every((slot) => slot.status === 'ready'),
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
            assert.equal(
              generations,
              mode === 'invalid-model' ? 3 : mode === 'transient-exhausted' ? 10 : 2,
              JSON.stringify({ failedCalls, healthyStarts, trace })
            );

            if (mode === 'transient-exhausted')
              assert.equal(healthyStarts, 2, JSON.stringify({ failedCalls, trace }));

            const first = ready.slots[0]!;

            assert.ok(first.attemptId);
            const attempt = yield* client['learning.attempt']({ attemptId: first.attemptId });
            const question = attempt.questions[0]!;

            if (question.kind === 'open') throw new Error('expected choice');

            const input = {
              slotId: first.slotId,
              answer: { type: 'choice' as const, choiceIds: [question.choices[0]!.id] }
            };

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
            assert.equal(rejected.kind, 'invalid_input');
            yield* client['learning.answerPracticeQuestion'](input);
            const refill = yield* client['learning.practice']({ projectId: project.id });

            assert.deepEqual(
              refill.slots.map((slot) => slot.kind),
              ['choice', 'open']
            );
            const stopped = yield* client['learning.stopPractice']({ projectId: project.id });

            assert.equal(stopped.enabled, false);
            assert.equal(stopped.slots.length, 0);
            const count = generations;

            yield* client['system.stopWorkers']({});
            yield* client['system.startWorkers']({});
            const refillSlot = refill.slots.find((slot) => slot.kind === 'open')!;
            let drained = false;

            for (let i = 0; i < 100; i++) {
              const executions = yield* client['workflows.executions']({
                limit: 100,
                correlationId: refillSlot.slotId
              });

              if (
                executions.items.length &&
                executions.items.every((execution) =>
                  ['completed', 'cancelled'].includes(execution.status)
                )
              ) {
                drained = true;
                break;
              }

              yield* Effect.sleep('25 millis');
            }

            assert.equal(drained, true);
            assert.equal(generations, count);
            assert.equal(yield* client['projects.deleteProject']({ id: project.id }), true);
            assert.deepEqual(app.store.db.orm.all('PRAGMA foreign_key_check'), []);
          })
        )
      );
    }
  );
