import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Option } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

test(
  'native workflow RPC exposes bounded status and persists cancellation while the worker is stopped',
  { timeout: 10000 },
  async () => {
    const location = createTestDatabase();
    let app = await App.open({ path: location.path });
    let server = await serve(app);

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            assert.deepEqual((yield* client['workflows.executions']({ limit: 10 })).items, []);
            const source = yield* client['sources.createSource']({
              name: 'waiting.png',
              bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
              projectId: null
            });
            const processing = yield* client['sources.sourceProcessing']({ id: source.id });

            yield* client['system.startWorkers']({});

            for (let attempt = 0; attempt < 100; attempt++) {
              const page = yield* client['workflows.executions']({
                limit: 10,
                correlationId: processing.requestId!
              });
              const execution = page.items.find((item) => item.workflow === 'source-ingestion/v1');

              if (execution?.status === 'suspended') {
                assert.equal(execution.canCancel, true);
                assert.equal(execution.outcome, null);
                assert.deepEqual(
                  (yield* client['workflows.execution']({ id: execution.id })).id,
                  execution.id
                );
                yield* client['system.stopWorkers']({});
                const cancelled = yield* client['workflows.cancelExecution']({
                  id: execution.id,
                  mode: 'unsafe'
                });

                assert.ok(['cancelling', 'cancelled'].includes(cancelled.status));
                assert.equal(cancelled.canCancel, false);
                const repeated = yield* client['workflows.cancelExecution']({
                  id: execution.id,
                  mode: 'safe'
                });

                assert.ok(['cancelling', 'cancelled'].includes(repeated.status));
                assert.equal('payload' in repeated, false);
                assert.equal('ownerToken' in repeated, false);

                for (const createdAtMs of [-1n, 9223372036854775808n])
                  assert.equal(
                    (yield* Effect.exit(
                      client['workflows.executions']({
                        limit: 1,
                        before: { id: execution.id, createdAtMs }
                      })
                    ))._tag,
                    'Failure'
                  );

                return;
              }

              yield* Effect.sleep('25 millis');
            }

            assert.fail('Source did not reach its durable configuration wait');
          })
        )
      );
      await server.close();
      await app.close();
      app = await App.open({ path: location.path });
      server = await serve(app);
      await app.workers.start();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            for (let attempt = 0; attempt < 100; attempt++) {
              const page = yield* client['workflows.executions']({ limit: 10 });
              const execution = page.items.find((item) => item.workflow === 'source-ingestion/v1');

              if (execution?.status === 'cancelled') {
                assert.equal(
                  (yield* client['sources.sourceProcessing']({
                    id: (yield* client['sources.sources']({ limit: 1 })).items[0]!.id
                  })).documentId,
                  null
                );
                assert.ok(
                  Option.isSome(yield* client['workflows.findExecution']({ id: execution.id }))
                );
                assert.equal(page.next, null);

                return;
              }

              yield* Effect.sleep('25 millis');
            }

            assert.fail('Cancelled workflow was not recovered after reopening');
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

test(
  'workflow status distinguishes terminal failures and paginates without exposing checkpoints',
  { timeout: 10000 },
  async () => {
    const location = createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);

    await app.workers.start();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            yield* client['sources.createSource']({
              name: 'ready.txt',
              bytes: new TextEncoder().encode('Ready'),
              projectId: null
            });
            yield* client['sources.createSource']({
              name: 'unsupported.wav',
              bytes: new TextEncoder().encode('RIFF0000WAVE'),
              projectId: null
            });

            for (let attempt = 0; attempt < 100; attempt++) {
              const page = yield* client['workflows.executions']({ limit: 100 });
              const ingestions = page.items.filter(
                (execution) => execution.workflow === 'source-ingestion/v1'
              );

              if (
                ingestions.length === 2 &&
                page.items.every((execution) => execution.status === 'completed')
              ) {
                assert.deepEqual(
                  ingestions
                    .map((execution) => execution.outcome)
                    .sort((a, b) => (a ?? '').localeCompare(b ?? '')),
                  ['failure', 'success']
                );
                assert.equal(
                  ingestions.find((execution) => execution.outcome === 'failure')?.failureKind,
                  'unsupported'
                );
                assert.ok(page.items.every((execution) => !execution.canCancel));
                const first = yield* client['workflows.executions']({ limit: 1 });

                assert.ok(first.next);
                const second = yield* client['workflows.executions']({
                  limit: 1,
                  before: first.next
                });

                assert.equal(second.items.length, 1);
                assert.notEqual(first.items[0]?.id, second.items[0]?.id);
                const seen = [first.items[0]!.id, second.items[0]!.id];
                let cursor = second.next;

                while (cursor !== null) {
                  const next = yield* client['workflows.executions']({ limit: 1, before: cursor });

                  seen.push(...next.items.map((execution) => execution.id));
                  cursor = next.next;
                }

                assert.equal(new Set(seen).size, seen.length);
                assert.ok(ingestions.every((execution) => seen.includes(execution.id)));
                const target = ingestions[0]!;

                assert.deepEqual(
                  yield* client['workflows.cancelExecution']({ id: target.id, mode: 'unsafe' }),
                  target
                );
                assert.deepEqual(
                  Object.keys(target).sort(),
                  [
                    'id',
                    'workflow',
                    'correlationId',
                    'status',
                    'outcome',
                    'failureKind',
                    'canCancel',
                    'createdAtMs',
                    'updatedAtMs'
                  ].sort()
                );
                assert.equal(
                  (yield* Effect.exit(client['workflows.executions']({ limit: 0 })))._tag,
                  'Failure'
                );

                return;
              }

              yield* Effect.sleep('25 millis');
            }

            assert.fail('Source workflows did not reach terminal states');
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

test(
  'unsafe workflow cancellation aborts an active real HTTP fetch',
  { timeout: 10000 },
  async () => {
    const { createServer } = await import('node:http');
    let entered!: () => void;
    let aborted!: () => void;
    const requested = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const peer = createServer((_request, response) => {
      response.on('close', aborted);
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write('<html><body>pending');
      entered();
    });

    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
    const address = peer.address();

    if (!address || typeof address === 'string') throw new Error('HTTP peer missing');

    const location = createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);

    await app.workers.start();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const source = yield* client['sources.addLink']({
              url: `http://127.0.0.1:${address.port}`,
              projectId: null
            });
            const processing = yield* client['sources.sourceProcessing']({ id: source.id });

            yield* Effect.promise(() => requested);
            const execution = (yield* client['workflows.executions']({
              limit: 10,
              correlationId: processing.requestId!
            })).items.find((item) => item.workflow === 'source-ingestion/v1');

            assert.ok(execution);
            const result = yield* client['workflows.cancelExecution']({
              id: execution.id,
              mode: 'unsafe'
            });

            assert.ok(['cancelled', 'cancelling'].includes(result.status));
            yield* Effect.promise(() => closed).pipe(Effect.timeout('2 seconds'));
            assert.equal(
              (yield* client['sources.sourceProcessing']({ id: source.id })).documentId,
              null
            );
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
      location.cleanup();
    }
  }
);
