import { Context, Effect, Option, Queue, Result, Schema, Stream } from 'effect';
import type { AtomRegistry } from 'effect/reactivity';
import { RpcSchema } from 'effect/rpc';
import type { Rpc } from 'effect/rpc';
import type { RpcClient, RpcGroup } from 'effect/rpc';
import type { RpcClientError } from 'effect/rpc/RpcClientError';
import { createElement, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';

import { StudyError, EndpointPolicy } from './index.ts';
import type { StudyRpc } from './index.ts';
/** Controlled, schema-validated protocol streams for component product tests. */
import { RpcProvider, configureRpcTransport } from './react.ts';
import type { ProtocolTransport } from './react.ts';

export function rpcTestTransport(
  read: (tag: string, input: unknown) => Promise<unknown>,
  registry?: AtomRegistry.AtomRegistry
) {
  const observers = new Set<() => Promise<void>>();
  const decodeFailure = (definition: Rpc.AnyWithProps, error: unknown) => {
    const schema = RpcSchema.isStreamSchema(definition.successSchema)
      ? definition.successSchema.error
      : definition.errorSchema;
    const value =
      error instanceof StudyError
        ? { kind: error.kind, message: error.message, retryAfterMs: error.retryAfterMs }
        : error instanceof Error
          ? { kind: 'internal', message: error.message, retryAfterMs: null }
          : error;

    return Schema.decodeUnknownSync(Schema.toType(schema))(value);
  };
  const transport: ProtocolTransport = {
    execute: <R extends Rpc.AnyWithProps>(
      definition: R,
      input: Rpc.AnyWithProps extends R ? unknown : Rpc.Payload<R>
    ) =>
      Effect.tryPromise({
        try: async () => {
          try {
            const value = await read(
              definition._tag,
              Schema.decodeUnknownSync(Schema.toType(definition.payloadSchema))(input)
            );

            return Schema.decodeUnknownSync(Schema.toType(definition.successSchema))(
              value
            ) as Rpc.Success<R>;
          } finally {
            const policy = Context.getOption(definition.annotations, EndpointPolicy);

            if (Option.isSome(policy) && policy.value.kind === 'mutation')
              void Promise.all([...observers].map((refresh) => refresh()));
          }
        },
        catch: (error) => decodeFailure(definition, error) as Rpc.Error<R>
      }),
    subscribe: <R extends Rpc.AnyWithProps>(
      definition: R,
      input: Rpc.AnyWithProps extends R ? unknown : Rpc.Payload<R>
    ) =>
      Stream.callback<unknown, Rpc.Error<R>>((queue) =>
        Effect.gen(function* () {
          let active = true;
          let pending = false;
          let dirty = false;
          const readSnapshot = async () => {
            try {
              const data = await read(
                definition._tag.replace(/\.live$/, ''),
                Schema.decodeUnknownSync(Schema.toType(definition.payloadSchema))(input)
              );

              if (active)
                Queue.offerUnsafe(queue, { _tag: 'Snapshot', result: Result.succeed(data) });
            } catch (error) {
              if (active)
                Queue.offerUnsafe(queue, {
                  _tag: 'Snapshot',
                  result: Result.fail(decodeFailure(definition, error))
                });
            }
          };
          const refresh = async () => {
            if (!active) return;

            dirty = true;

            // Pending queries may intentionally never resolve. Queue their refresh without
            // holding unrelated notifications; the active reader drains the latest state.
            if (pending) return;

            pending = true;

            try {
              while (active && dirty) {
                dirty = false;
                await readSnapshot();
              }
            } finally {
              pending = false;
            }
          };

          const release = () => {
            active = false;
            observers.delete(refresh);
          };

          yield* Effect.addFinalizer(() => Effect.sync(release));
          observers.add(refresh);
          yield* Effect.promise(refresh);
        })
      ).pipe(
        Stream.map((value) => {
          const schema = RpcSchema.isStreamSchema(definition.successSchema)
            ? definition.successSchema.success
            : definition.successSchema;

          // Native RPC's stream marker carries this exact chunk schema; preserve its generic correlation after validation.
          return Schema.decodeUnknownSync(Schema.toType(schema))(value) as Rpc.SuccessChunk<R>;
        })
      )
  };
  const notify = () => Promise.all([...observers].map((refresh) => refresh()));

  function Wrapper({ children }: { children: ReactNode }) {
    useLayoutEffect(() => configureRpcTransport(transport), []);

    return createElement(RpcProvider, { transport, policy: testPolicy, registry }, children);
  }

  return { transport, notify, wrapper: Wrapper, activeSubscriptions: () => observers.size };
}

const testPolicy = {
  livenessTimeoutMs: 30_000,
  reconnectDelayMs: 100,
  retryable: () => false,
  unauthorized: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    (error.kind === 'auth' || error.kind === 'not_found')
};

type NativeHandlers = RpcClient.RpcClient<RpcGroup.Rpcs<typeof StudyRpc>, RpcClientError>;

type TestHandlers = {
  readonly [K in keyof NativeHandlers]?: NativeHandlers[K] extends (
    input: infer I,
    ...args: never[]
  ) => infer Out
    ? (
        input: I
      ) => Out | (Out extends Effect.Effect<infer A, unknown, unknown> ? Promise<A> : never)
    : never;
};

/** Snapshot fixtures use canonical endpoint names and fail on any unplanned operation. */
export type RpcFixtureValues = {
  readonly [K in keyof NativeHandlers]?: NativeHandlers[K] extends (
    ...args: any[]
  ) => Effect.Effect<infer A, any, any>
    ? A
    : never;
};

export function rpcValuesTransport(values: RpcFixtureValues, registry?: AtomRegistry.AtomRegistry) {
  return rpcTestTransport(async (tag) => {
    if (!Object.hasOwn(values, tag))
      throw new StudyError('unsupported', `Unexpected test RPC: ${tag}`);

    return Reflect.get(values, tag);
  }, registry);
}

/** Reuses typed native handler fixtures; responses still cross the canonical schema boundary. */
export function rpcHandlersTransport(handlers: TestHandlers, registry?: AtomRegistry.AtomRegistry) {
  return rpcTestTransport(async (tag, input) => {
    const method: unknown = Reflect.get(handlers, tag);

    if (typeof method !== 'function')
      throw new StudyError('unsupported', `Unexpected test RPC: ${tag}`);

    const result: unknown = method(input);

    if (!Effect.isEffect(result)) return Promise.resolve(result);

    // TestHandlers only admits service-free client operations; reflection erased that correlation.
    return Effect.runPromise(result as Effect.Effect<unknown, unknown>);
  }, registry);
}

/** Native schema-derived fixture methods; no client or transport is initialized by this type. */
export type StudyClient = NativeHandlers;

/** Plain return values, promises and Effects all cross the canonical RPC schema boundary. */
type ScenarioHandlers = {
  readonly [K in keyof NativeHandlers]?: NativeHandlers[K] extends (
    input: infer I,
    ...args: never[]
  ) => Effect.Effect<infer A, any, any>
    ? (input: I) => A | Promise<A> | Effect.Effect<A, unknown>
    : never;
};

/** Per-test RPC state with explicit declarations and end-of-test verification of missing setup. */
export function createRpcScenario() {
  const values: RpcFixtureValues = {};
  const handlers: ScenarioHandlers = {};
  const unexpected: Error[] = [];
  const fixture = rpcTestTransport(async (tag, input) => {
    const handler: unknown = Reflect.get(handlers, tag);

    if (typeof handler === 'function') {
      const result: unknown = handler(input);

      return Effect.isEffect(result)
        ? Effect.runPromise(result as Effect.Effect<unknown, unknown>)
        : result;
    }

    if (Object.hasOwn(values, tag)) return Reflect.get(values, tag);

    const error = new StudyError('unsupported', `Unplanned test RPC: ${tag}`);

    unexpected.push(error);

    throw error;
  });
  const given = (next: RpcFixtureValues) => {
    for (const [tag, value] of Object.entries(next)) {
      Reflect.set(values, tag, value);
      Reflect.deleteProperty(handlers, tag);
    }
  };

  return {
    ...fixture,
    given,
    handle(next: ScenarioHandlers) {
      for (const [tag, handler] of Object.entries(next)) {
        Reflect.set(handlers, tag, handler);
        Reflect.deleteProperty(values, tag);
      }
    },
    async update(next: RpcFixtureValues) {
      given(next);
      await fixture.notify();
    },
    verify() {
      if (unexpected.length)
        throw new AggregateError(
          unexpected,
          `Unplanned test RPC: ${unexpected.map((error) => error.message).join(', ')}`
        );
    }
  };
}
