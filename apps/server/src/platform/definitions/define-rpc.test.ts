import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyError, failureSchema } from '@study/contracts/errors';
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Schema,
  Stream
} from 'effect';
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc';

import { defineRpc } from '#server/platform/definitions/define-rpc';

const Group = RpcGroup.make(
  Rpc.make('test.read', {
    payload: { name: Schema.String },
    success: Schema.String,
    error: failureSchema
  })
);

const Streams = RpcGroup.make(
  Rpc.make('test.stream', { success: Schema.String, error: failureSchema, stream: true })
);

test('maps StudyError through native RPC without losing retryAfterMs', async () => {
  const layer = defineRpc(
    Group,
    Effect.succeed({
      'test.read': () => Effect.fail(new StudyError('rate_limited', 'slow', { retryAfterMs: 42 }))
    })
  );
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(Group, { flatten: true });

        return yield* client('test.read', { name: 'Ada' }).pipe(Effect.flip);
      }).pipe(Effect.provide(layer))
    )
  );

  assert.deepEqual(result, { kind: 'rate_limited', message: 'slow', retryAfterMs: 42 });
});

class Initialization extends Context.Service<Initialization, string>()('test/RpcInitialization') {}

class Operation extends Context.Service<Operation, string>()('test/RpcOperation') {}

test('handler creation is lazy and scoped, and operations retain their dependencies', async () => {
  let acquisitions = 0;
  let releases = 0;
  const release = Effect.sync(() => {
    releases++;
  });
  const layer = defineRpc(
    Group,
    Effect.gen(function* () {
      const prefix = yield* Initialization;

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          acquisitions++;
        }),
        () => release
      );

      return {
        'test.read': ({ name }) => Effect.map(Operation, (suffix) => prefix + name + suffix)
      };
    })
  );

  assert.equal(acquisitions, 0);

  for (const prefix of ['Hello ', 'Ciao ']) {
    const value = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(Group, { flatten: true });

          return yield* client('test.read', { name: 'Ada' });
        }).pipe(
          Effect.provide(
            layer.pipe(
              Layer.provide(Layer.succeed(Initialization, prefix)),
              Layer.provide(Layer.succeed(Operation, '!'))
            )
          )
        )
      )
    );

    assert.equal(value, prefix + 'Ada!');
  }

  assert.equal(acquisitions, 2);
  assert.equal(releases, 2);
});

for (const wrapped of [false, true])
  test(`stream StudyError mapping, effect wrapped: ${wrapped}`, async () => {
    const error = new StudyError('transient', 'retry', { retryAfterMs: 17 });
    const stream = Stream.concat(Stream.succeed('first'), Stream.fail(error));
    const layer = wrapped
      ? defineRpc(Streams, Effect.succeed({ 'test.stream': () => Effect.succeed(stream) }))
      : defineRpc(Streams, Effect.succeed({ 'test.stream': () => Rpc.fork(stream) }));
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(Streams, { flatten: true });

          return yield* client('test.stream', undefined).pipe(Stream.runCollect, Effect.flip);
        }).pipe(Effect.provide(layer))
      )
    );

    assert.deepEqual(result, { kind: 'transient', message: 'retry', retryAfterMs: 17 });
  });

test('native dequeue handlers retain streaming failures', async () => {
  const layer = defineRpc(
    Streams,
    Effect.succeed({
      'test.stream': () =>
        Effect.gen(function* () {
          const queue = yield* Queue.make<string, StudyError>();

          yield* Queue.offer(queue, 'first');
          yield* Queue.fail(
            queue,
            new StudyError('transient', 'queue failed', { retryAfterMs: 9 })
          );

          return queue;
        })
    })
  );
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(Streams, { flatten: true });

        return yield* client('test.stream', undefined).pipe(Stream.runCollect, Effect.flip);
      }).pipe(Effect.provide(layer))
    )
  );

  assert.deepEqual(result, { kind: 'transient', message: 'queue failed', retryAfterMs: 9 });
});

test('stream cancellation releases the handler resource', async () => {
  let released = 0;
  const release = Effect.sync(() => {
    released++;
  });

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const layer = defineRpc(
          Streams,
          Effect.succeed({
            'test.stream': () =>
              Effect.succeed(
                Stream.unwrap(
                  Effect.acquireRelease(Deferred.succeed(started, undefined), () => release).pipe(
                    Effect.as(Stream.never)
                  )
                )
              )
          })
        );

        yield* Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(Streams, { flatten: true });
          const fiber = yield* client('test.stream', undefined).pipe(
            Stream.runDrain,
            Effect.forkChild
          );

          yield* Deferred.await(started);
          yield* Fiber.interrupt(fiber);
        }).pipe(Effect.provide(layer));
      })
    )
  );
  assert.equal(released, 1);
});

test('preserves unrelated typed errors, initialization failures and defects', async () => {
  const Other = RpcGroup.make(
    Rpc.make('other', {
      success: Schema.String,
      error: Schema.Struct({ _tag: Schema.Literal('Other') })
    })
  );
  const other = { _tag: 'Other' as const };
  const layer = defineRpc(Other, Effect.succeed({ other: () => Effect.fail(other) }));
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const handler = yield* Other.accessHandler('other');

      return yield* handler(undefined, {} as Parameters<typeof handler>[1]).pipe(Effect.flip);
    }).pipe(Effect.provide(layer))
  );

  assert.equal(result, other);
  const initialization = new StudyError('config', 'initialization');
  const failed = defineRpc(
    Group,
    Effect.fail(initialization) as Effect.Effect<
      { 'test.read': () => Effect.Effect<string> },
      StudyError
    >
  );

  assert.equal(
    await Effect.runPromise(Layer.build(failed).pipe(Effect.scoped, Effect.flip)),
    initialization
  );
  const defect = new Error('defect');
  const broken = defineRpc(Group, Effect.succeed({ 'test.read': () => Effect.die(defect) }));
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const handler = yield* Group.accessHandler('test.read');

      return yield* Effect.exit(handler({ name: 'Ada' }, {} as Parameters<typeof handler>[1]));
    }).pipe(Effect.provide(broken))
  );

  assert.ok(Exit.isFailure(exit));
  assert.ok(Cause.hasDies(exit.cause));
});

function typeAssertions() {
  // @ts-expect-error missing handler
  defineRpc(Group, Effect.succeed({}));
  const extra = Effect.succeed({ 'test.read': () => Effect.succeed(''), extra: () => Effect.void });

  // @ts-expect-error extra handler
  defineRpc(Group, extra);
  // @ts-expect-error wrong payload
  defineRpc(Group, Effect.succeed({ 'test.read': (_input: number) => Effect.succeed('') }));
  // @ts-expect-error wrong success
  defineRpc(Group, Effect.succeed({ 'test.read': () => Effect.succeed(1) }));
  // @ts-expect-error unrelated errors must be allowed by the contract
  defineRpc(Group, Effect.succeed({ 'test.read': () => Effect.fail({ _tag: 'Other' }) }));
  const layer = defineRpc(
    Group,
    Effect.map(Initialization, (prefix) => ({
      'test.read': ({ name }) => Effect.map(Operation, (suffix) => prefix + name + suffix)
    }))
  );
  const exact: Layer.Layer<Rpc.Handler<'test.read'>, never, Initialization | Operation> = layer;
  // @ts-expect-error operation requirement cannot disappear
  const missingOperation: Layer.Layer<Rpc.Handler<'test.read'>, never, Initialization> = layer;
  const stream = defineRpc(
    Streams,
    Effect.succeed({
      'test.stream': () =>
        Effect.map(Initialization, (prefix) =>
          Stream.map(Stream.fromEffect(Operation), (suffix) => prefix + suffix)
        )
    })
  );
  const streamExact: Layer.Layer<
    Rpc.Handler<'test.stream'>,
    never,
    Initialization | Operation
  > = stream;
  // @ts-expect-error effect-wrapped stream requirements cannot disappear
  const missingStreamOperation: Layer.Layer<
    Rpc.Handler<'test.stream'>,
    never,
    Initialization
  > = stream;

  return { exact, missingOperation, streamExact, missingStreamOperation };
}

void typeAssertions;
