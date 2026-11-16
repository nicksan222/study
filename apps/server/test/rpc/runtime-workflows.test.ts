import { StudyRpc } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises workflow execution listing, bounded public status, and persisted         │
 * │ cancellation while workers stop and restart. It also checks invalid cursors and that     │
 * │ payloads and owner tokens stay private.                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: native workflow RPC exposes bounded status and persists cancellation while    │
 * │   the worker is stopped; workflow status distinguishes terminal failures and paginates   │
 * │   without exposing checkpoints.                                                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/runtime/index with real SQLite and application        │
 * │ resources; fixture cleanup closes owned resources.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Option } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { serve } from '#server/runtime/index';

const isSourceIngestion = (item: { workflow: string }) => item.workflow === 'source-ingestion/v1';

const isCancelledSource = (item: { workflow: string; status: string }) =>
  isSourceIngestion(item) && item.status === 'cancelled';

const isCompleted = (item: { status: string }) => item.status === 'completed';

test.stable(
  'native workflow RPC exposes bounded status and persists cancellation while the worker is stopped',
  { timeout: 10000 },
  async ({ resources: location, expect, pollUntil, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let app = await location.openApp({ path: location.path });
    let server = await serve(app);

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            expect((yield* client['workflows.executions']({ limit: 10 })).items).toStrictEqual([]);
            const source = yield* client['sources.createSource']({
              name: 'waiting.png',
              bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
              projectId: null
            });
            const processing = yield* client['sources.sourceProcessing']({ id: source.id });

            yield* client['system.startWorkers']({});

            const execution = yield* pollUntil(
              Effect.gen(function* () {
                const page = yield* client['workflows.executions']({
                  limit: 10,
                  correlationId: processing.requestId!
                });

                return page.items.find(isSourceIngestion);
              }),
              (value) => value?.status === 'suspended',
              {
                attempts: 100,
                interval: '25 millis',
                message: 'Source did not reach its durable configuration wait'
              }
            );

            assert.ok(execution?.status === 'suspended');
            assert.ok(execution.canCancel === true);
            assert.ok(execution.outcome === null);
            expect((yield* client['workflows.execution']({ id: execution.id })).id).toStrictEqual(
              execution.id
            );
            yield* client['system.stopWorkers']({});
            const cancelled = yield* client['workflows.cancelExecution']({
              id: execution.id,
              mode: 'unsafe'
            });

            assert.ok(['cancelling', 'cancelled'].includes(cancelled.status));
            assert.ok(cancelled.canCancel === false);
            const repeated = yield* client['workflows.cancelExecution']({
              id: execution.id,
              mode: 'safe'
            });

            assert.ok(['cancelling', 'cancelled'].includes(repeated.status));
            assert.ok('payload' in repeated === false);
            assert.ok('ownerToken' in repeated === false);

            for (const createdAtMs of [-1n, 9223372036854775808n])
              assert.ok(
                (yield* Effect.exit(
                  client['workflows.executions']({
                    limit: 1,
                    before: { id: execution.id, createdAtMs }
                  })
                ))._tag === 'Failure'
              );

            return;
          })
        )
      );
      await server.close();
      await app.close();
      app = await location.openApp({ path: location.path });
      server = await serve(app);
      await app.workers.start();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            const page = yield* pollUntil(
              client['workflows.executions']({ limit: 10 }),
              (value) => value.items.some(isCancelledSource),
              {
                attempts: 100,
                interval: '25 millis',
                message: 'Cancelled workflow was not recovered after reopening'
              }
            );
            const execution = page.items.find(isSourceIngestion);

            assert.ok(execution?.status === 'cancelled');
            assert.ok(
              (yield* client['sources.sourceProcessing']({
                id: (yield* client['sources.sources']({ limit: 1 })).items[0]!.id
              })).documentId === null
            );
            assert.ok(
              Option.isSome(yield* client['workflows.findExecution']({ id: execution.id }))
            );
            assert.ok(page.next === null);

            return;
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

test.stable(
  'workflow status distinguishes terminal failures and paginates without exposing checkpoints',
  { timeout: 10000 },
  async ({ resources: location, pollUntil, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const app = await location.openApp({ path: location.path });
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

            const { page, ingestions } = yield* pollUntil(
              Effect.gen(function* () {
                const page = yield* client['workflows.executions']({ limit: 100 });
                const ingestions = page.items.filter(isSourceIngestion);

                return { page, ingestions };
              }),
              (value) => value.ingestions.length === 2 && value.page.items.every(isCompleted),
              {
                attempts: 100,
                interval: '25 millis',
                message: 'Source workflows did not reach terminal states'
              }
            );

            expect(
              ingestions
                .map((execution) => execution.outcome)
                .sort((a, b) => (a ?? '').localeCompare(b ?? ''))
            ).toStrictEqual(['failure', 'success']);
            assert.ok(
              ingestions.find((execution) => execution.outcome === 'failure')?.failureKind ===
                'unsupported'
            );
            assert.ok(page.items.every((execution) => !execution.canCancel));
            const first = yield* client['workflows.executions']({ limit: 1 });

            assert.ok(first.next);
            const second = yield* client['workflows.executions']({
              limit: 1,
              before: first.next
            });

            assert.strictEqual(second.items.length, 1);
            assert.notStrictEqual(first.items[0]?.id, second.items[0]?.id);
            const seen = [first.items[0]!.id, second.items[0]!.id];
            let cursor = second.next;

            while (cursor !== null) {
              const next = yield* client['workflows.executions']({ limit: 1, before: cursor });

              seen.push(...next.items.map((execution) => execution.id));
              cursor = next.next;
            }

            assert.strictEqual(new Set(seen).size, seen.length);
            assert.ok(ingestions.every((execution) => seen.includes(execution.id)));
            const target = ingestions[0]!;

            expect(
              yield* client['workflows.cancelExecution']({ id: target.id, mode: 'unsafe' })
            ).toStrictEqual(target);
            expect(Object.keys(target).sort()).toStrictEqual(
              [
                'id',
                'workflow',
                'correlationId',
                'status',
                'outcome',
                'failureKind',
                'configurationWaitReason',
                'canCancel',
                'createdAtMs',
                'updatedAtMs'
              ].sort()
            );
            assert.ok(
              (yield* Effect.exit(client['workflows.executions']({ limit: 0 })))._tag === 'Failure'
            );

            return;
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

test.stable(
  'unsafe workflow cancellation aborts an active real HTTP fetch',
  { timeout: 10000 },
  async ({ resources: location, onTestFinished, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let entered!: () => void;
    let aborted!: () => void;
    const requested = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const peer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        request.signal.addEventListener('abort', aborted, { once: true });
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('<html><body>pending'));
            entered();
          },
          cancel() {
            aborted();
          }
        });

        return new Response(stream, { headers: { 'content-type': 'text/html' } });
      }
    });

    onTestFinished(() => peer.stop(true));

    const app = await location.openApp({ path: location.path });
    const server = await serve(app);

    await app.workers.start();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const source = yield* client['sources.addLink']({
              url: `http://127.0.0.1:${peer.port}`,
              projectId: null
            });
            const processing = yield* client['sources.sourceProcessing']({ id: source.id });

            yield* Effect.promise(() => requested);
            const execution = (yield* client['workflows.executions']({
              limit: 10,
              correlationId: processing.requestId!
            })).items.find(isSourceIngestion);

            assert.ok(execution);
            const result = yield* client['workflows.cancelExecution']({
              id: execution.id,
              mode: 'unsafe'
            });

            assert.ok(['cancelled', 'cancelling'].includes(result.status));
            yield* Effect.promise(() => closed).pipe(Effect.timeout('2 seconds'));
            assert.ok(
              (yield* client['sources.sourceProcessing']({ id: source.id })).documentId === null
            );
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      await peer.stop(true);
      await location.close();
    }
  }
);
