import { projectIdSchema } from '@study/contracts/ids';
import { StudyRpc } from '@study/contracts/rpc';
import { createTestDatabase } from '@study/db/testing';
import { makeStudyClient } from '@study/server/client';
import { App, serve } from '@study/server/runtime';
import { testStable } from '@study/testing/vitest';
import { studyRpcProxy } from '@study/tooling/development/rpc-proxy';
import { Effect, Exit, Schema } from 'effect';
import { createServer } from 'vite-plus';
import { assert, expect, onTestFinished } from 'vite-plus/test';

import { CreationFrames, creationResponse } from './creation-response.ts';
import { owned } from './lifecycle.ts';

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n');

const request = (tag: string, id: string | number = '42') =>
  bytes({ _tag: 'Request', tag, id, payload: {}, headers: [] });

const note = {
  id: '7',
  projectIds: [],
  title: 'River 日本語',
  titleSource: 'user',
  archivedAt: null,
  createdAt: '1',
  updatedAt: '1'
};

const success = (requestId: string | number = '42') =>
  bytes({ _tag: 'Exit', requestId, exit: { _tag: 'Success', value: note } });

testStable(
  'creation proof requires the exact operation and request id, never reads or uploads',
  () => {
    for (const tag of [
      'notes.notes',
      'sources.upload',
      'notes.createNote',
      'notes.createUntitledNote.extra'
    ]) {
      const frames = new CreationFrames();

      frames.request(request(tag));
      assert.strictEqual(frames.response(success()), undefined);
    }

    const frames = new CreationFrames();

    frames.request(request('notes.createUntitledNote'));
    assert.strictEqual(frames.response(success('different')), undefined);
    assert.strictEqual(frames.response(success(42)), undefined);
    assert.strictEqual(
      frames.response(
        bytes({
          _tag: 'Exit',
          requestId: '42',
          exit: { _tag: 'Failure', cause: [] }
        })
      ),
      undefined
    );
    assert.strictEqual(
      frames.response(bytes({ _tag: 'Chunk', requestId: '42', values: [note] })),
      undefined
    );
    assert.strictEqual(frames.response(success())?.note.id, 7n);
  }
);

testStable(
  'every byte split, including UTF-8 and the final newline, preserves complete Exit framing',
  () => {
    const encoded = success();
    const encodedRequest = request('notes.createUntitledNote');

    for (let split = 0; split < encoded.length; split++) {
      const frames = new CreationFrames();

      for (const byte of encodedRequest) frames.request(Buffer.from([byte]));

      assert.strictEqual(frames.response(encoded.subarray(0, split)), undefined);
      assert.strictEqual(frames.response(encoded.subarray(split))?.note.title, note.title);
    }
  }
);

testStable('unarmed teardown rejects waiters and repeated arming is forbidden', async () => {
  const fault = creationResponse();
  const loss = fault.arm();

  assert.throws(() => fault.arm());
  await fault.close();
  await expect(loss.held).rejects.toBeDefined();
  await fault.close();
});

testStable('owner teardown terminates a creation response that arrives later', async () => {
  const entered = Promise.withResolvers<void>();
  const respond = Promise.withResolvers<void>();
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(incoming) {
      await incoming.arrayBuffer();
      entered.resolve();
      await respond.promise;

      return new Response(success(), { headers: { 'content-type': 'application/ndjson' } });
    }
  });
  const fault = creationResponse();
  const loss = fault.arm();
  const web = await createServer({
    configFile: false,
    server: {
      host: '127.0.0.1',
      port: 0,
      hmr: false,
      proxy: { '/rpc': fault.proxy({ target: upstream.url.href }) }
    },
    optimizeDeps: { noDiscovery: true }
  });

  try {
    await web.listen();
    const address = web.httpServer?.address();

    assert.ok(address && typeof address !== 'string');
    const signal = AbortSignal.timeout(5000);
    const pending = fetch(`http://127.0.0.1:${address.port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/ndjson' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(request('notes.createUntitledNote'));
          controller.close();
        }
      }),
      signal
    });

    await entered.promise;
    await fault.close();
    await expect(loss.held).rejects.toThrow('Creation response owner closed before commit');
    respond.resolve();
    const body = await pending.then((response) => response.text()).catch(() => null);

    assert.ok(body === null || body === '', 'closed exchange must not deliver its receipt');
    assert.strictEqual(
      signal.aborted,
      false,
      'owner teardown must close before the safety timeout'
    );
  } finally {
    respond.resolve();
    await fault.close();
    await web.close();
    await upstream.stop(true);
  }
});

for (const cleanup of [
  'explicit drop',
  'journey failure',
  'runner cancellation',
  'failed Exit'
] as const) {
  testStable(
    `real committed creation loses only its receipt and drains on ${cleanup}`,
    async () => {
      let finalize: (() => Promise<void>) | undefined;
      let pending: Promise<Exit.Exit<unknown, unknown>> | undefined;
      let failed = false;
      const run = owned(
        async (own) => {
          const database = await createTestDatabase();

          own(() => database.cleanup());
          const app = await App.open({ path: await database.prepare() });

          own(() => app.close());
          const server = await serve(app);

          own(() => server.close());
          const fault = creationResponse();
          const proxy = studyRpcProxy(server.url);

          proxy['/rpc'] = fault.proxy(proxy['/rpc']!);
          const web = await createServer({
            configFile: false,
            server: { host: '127.0.0.1', port: 0, hmr: false, proxy },
            optimizeDeps: { noDiscovery: true }
          });

          own(() => web.close());
          own(async () => {
            await pending;
          });
          own(() => fault.close());
          await web.listen();
          const address = web.httpServer?.address();

          assert.ok(address && typeof address !== 'string');
          const baseUrl = `http://127.0.0.1:${address.port}`;
          const loss = fault.arm();
          const load = (url: string) =>
            Effect.runPromise(
              Effect.scoped(
                Effect.gen(function* () {
                  const client = yield* makeStudyClient(StudyRpc, { baseUrl: url });

                  return yield* client['notes.notes']({ limit: 100 });
                })
              )
            );
          const before = await load(baseUrl);

          assert.strictEqual(before.items.length, 0);
          pending = Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const client = yield* makeStudyClient(StudyRpc, { baseUrl });

                return yield* Effect.exit(
                  client['notes.createUntitledNote']({
                    initialMessage: { text: 'Exact committed draft', sourceIds: [] },
                    ...(cleanup === 'failed Exit'
                      ? { project: Schema.decodeUnknownSync(projectIdSchema)(999999n) }
                      : {})
                  })
                );
              })
            )
          );
          void pending.then(() => {
            failed = true;
          });

          if (cleanup === 'failed Exit') {
            assert.ok(Exit.isFailure(await pending));
            await expect(loss.held).rejects.toBeDefined();
            assert.strictEqual((await load(baseUrl)).items.length, 0);

            return;
          }

          const receipt = await loss.held;

          assert.strictEqual(failed, false, 'receipt must still be withheld');
          const committed = await load(server.url);

          assert.strictEqual(committed.items.length, 1);
          assert.strictEqual(committed.items[0]?.id, receipt.note.id);
          const thread = await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

                return yield* client['notes.thread']({ noteId: receipt.note.id, limit: 100 });
              })
            )
          );

          assert.strictEqual(thread.items.length, 1);
          const message = thread.items[0]!;

          assert.strictEqual(
            message.versions.find((v) => v.id === message.activeVersionId)?.text,
            'Exact committed draft'
          );
          assert.deepStrictEqual(
            await load(baseUrl),
            committed,
            'unrelated responses forward faithfully while held'
          );

          if (cleanup === 'runner cancellation') {
            await finalize!();

            return;
          }

          if (cleanup === 'journey failure') throw new Error('Deliberate journey failure');

          await loss.drop();
          assert.ok(Exit.isFailure(await pending!));
          // The one-shot fault is consumed: a later real creation must reply normally.
          await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const client = yield* makeStudyClient(StudyRpc, { baseUrl });
                const second = yield* client['notes.createUntitledNote']({});

                assert.notStrictEqual(second.id, receipt.note.id);
              })
            )
          );
          assert.strictEqual((await load(baseUrl)).items.length, 2);
        },
        (close) => {
          finalize = close;
          onTestFinished(close);
        }
      );

      if (cleanup === 'explicit drop' || cleanup === 'failed Exit') await run;
      else {
        const failure: unknown = await run.catch((error: unknown) => error);

        assert.ok(failure instanceof AggregateError);
        const messages = failure.errors.map((error: unknown) => {
          assert.ok(error instanceof Error);

          return error.message;
        });

        assert.deepStrictEqual(messages, [
          cleanup === 'journey failure'
            ? 'Deliberate journey failure'
            : 'E2E cancelled before cleanup completed'
        ]);
      }

      assert.strictEqual(failed, true, 'cleanup must await termination of the held exchange');
    }
  );
}
