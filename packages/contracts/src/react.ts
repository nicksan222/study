/** Optional React facade derived exclusively from canonical native RPC definitions. */
import { RegistryContext, RegistryProvider, useAtomValue } from '@effect/atom-react';
import { Effect, Equal, Hash, Option, Schema, Stream } from 'effect';
import { AsyncResult, Atom } from 'effect/reactivity';
import type { AtomRegistry } from 'effect/reactivity';
import type { Rpc } from 'effect/rpc';
import type { RpcClientError } from 'effect/rpc/RpcClientError';
import { createContext, createElement, useContext, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

import { failureSchema, isRetryable } from './errors.ts';
import { liveFrameSchema } from './protocol.ts';
import {
  liveQueryAtom,
  MutationContext,
  SubscriptionTimeout,
  useIndependentMutation,
  useLiveQuery
} from './react-state.ts';
import type { LivePolicy, LiveState, SubscriptionDefect, MutationDefect } from './react-state.ts';
import { endpoints } from './rpc.ts';

export { useIndependentMutation } from './react-state.ts';

export interface ProtocolTransport {
  execute<R extends Rpc.AnyWithProps>(
    definition: R,
    input: Rpc.AnyWithProps extends R ? unknown : Rpc.Payload<R>
  ): Effect.Effect<Rpc.Success<R>, Rpc.Error<R> | RpcClientError>;
  subscribe<R extends Rpc.AnyWithProps>(
    definition: R,
    input: Rpc.AnyWithProps extends R ? unknown : Rpc.Payload<R>
  ): Stream.Stream<Rpc.SuccessChunk<R>, Rpc.Error<R> | RpcClientError>;
}

type Endpoint = {
  readonly kind: 'query' | 'mutation' | 'event';
  readonly rpc: Rpc.AnyWithProps;
  readonly liveRpc?: Rpc.AnyWithProps;
};

export type RpcCallOptions = {
  readonly signal?: AbortSignal;
  readonly transport?: ProtocolTransport;
};

type QueryOptions = { readonly enabled?: boolean };

const defaultPolicy: LivePolicy<unknown> = {
  livenessTimeoutMs: 30_000,
  reconnectDelayMs: 500,
  retryable: (error) =>
    error instanceof SubscriptionTimeout ||
    !Schema.is(failureSchema)(error) ||
    isRetryable(error.kind),
  unauthorized: (error) =>
    Schema.is(failureSchema)(error) && (error.kind === 'auth' || error.kind === 'not_found')
};

function canonicalInput(value: unknown): string {
  if (value === undefined) return 'undefined';

  if (typeof value === 'bigint') return `bigint:${value}`;

  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) return `[${value.map(canonicalInput).join(',')}]`;

  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalInput(item)}`)
    .join(',')}}`;
}

class InputKey implements Equal.Equal {
  readonly key: string;
  readonly input: unknown;

  constructor(input: unknown) {
    this.input = structuredClone(input);
    this.key = canonicalInput(this.input);
  }

  [Equal.symbol](other: Equal.Equal): boolean {
    return other instanceof InputKey && other.key === this.key;
  }

  [Hash.symbol](): number {
    return Hash.string(this.key);
  }
}

function makeContext(transport: ProtocolTransport, policy: LivePolicy<unknown>) {
  const atoms = new WeakMap<Endpoint, (key: InputKey) => Atom.Atom<LiveState<unknown, unknown>>>();

  return {
    transport,
    query(endpoint: Endpoint, input: unknown) {
      let family = atoms.get(endpoint);

      if (!family) {
        family = Atom.family((key: InputKey) =>
          liveQueryAtom(() => {
            const payload = key.input;

            return transport
              .subscribe(endpoint.liveRpc ?? endpoint.rpc, payload)
              .pipe(
                Stream.map((frame) =>
                  Schema.decodeUnknownSync(
                    Schema.toType(liveFrameSchema(Schema.Unknown, Schema.Unknown))
                  )(frame)
                )
              );
          }, policy)
        );
        atoms.set(endpoint, family);
      }

      const normalized = Schema.decodeUnknownSync(Schema.toType(endpoint.rpc.payloadSchema))(input);

      return family(new InputKey(normalized));
    }
  };
}

const RpcContext = createContext<ReturnType<typeof makeContext> | null>(null);

let imperative: ProtocolTransport | undefined;

/** Composition owns transport discovery and security context; replacing transport isolates all reads. */
export function RpcProvider({
  transport,
  policy = defaultPolicy,
  registry,
  children
}: {
  readonly transport: ProtocolTransport;
  readonly policy?: LivePolicy<unknown>;
  readonly registry?: AtomRegistry.AtomRegistry;
  readonly children?: ReactNode;
}) {
  const context = useMemo(() => makeContext(transport, policy), [transport, policy]);

  return createElement(
    RpcContext.Provider,
    { value: context },
    createElement(
      MutationContext.Provider,
      { value: transport },
      registry
        ? createElement(RegistryContext.Provider, { value: registry }, children)
        : createElement(RegistryProvider, { defaultIdleTTL: 0, timeoutResolution: 1 }, children)
    )
  );
}

/** Configure scoped route-loader and one-shot operations at the application host boundary. */
export function configureRpcTransport(transport: ProtocolTransport) {
  imperative = transport;

  return () => {
    if (imperative === transport) imperative = undefined;
  };
}

function transportForRead() {
  if (!imperative) throw new Error('RPC transport is not configured');

  return imperative;
}

function useRpcContext() {
  const context = useContext(RpcContext);

  if (!context) throw new Error('RpcProvider is required');

  return context;
}

function presentation<A, E>(result: AsyncResult.AsyncResult<A, E>) {
  const common = {
    result,
    isPending: AsyncResult.isInitial(result),
    isLoading: AsyncResult.isInitial(result),
    isFetching: result.waiting,
    isError: AsyncResult.isFailure(result),
    isSuccess: AsyncResult.isSuccess(result)
  };

  if (result._tag === 'Initial')
    return { ...common, status: 'pending' as const, data: undefined, error: undefined };

  if (result._tag === 'Failure')
    return {
      ...common,
      status: 'error' as const,
      data: Option.getOrUndefined(AsyncResult.value(result)),
      error: Option.getOrUndefined(AsyncResult.error(result))
    };

  return { ...common, status: 'success' as const, data: result.value, error: undefined };
}

function bind(endpoint: Endpoint) {
  const read = async (input: unknown, options?: RpcCallOptions) => {
    options?.signal?.throwIfAborted();
    const transport = options?.transport ?? transportForRead();

    return Effect.runPromise(Effect.scoped(transport.execute(endpoint.rpc, input)), options);
  };

  if (endpoint.kind === 'query')
    return {
      read,
      useQueries(inputs: readonly unknown[]) {
        const context = useRpcContext();
        const registry = useContext(RegistryContext);
        const identity = canonicalInput(inputs);
        const snapshot = useRef({ identity, inputs });

        if (snapshot.current.identity !== identity) snapshot.current = { identity, inputs };

        const stableInputs = snapshot.current.inputs;
        const composed = useMemo(() => {
          const atoms = stableInputs.map((input) =>
            input === undefined ? disabled : context.query(endpoint, input)
          );

          return Atom.make((get) => atoms.map((atom) => ({ atom, state: get(atom) }))).pipe(
            Atom.setIdleTTL(0)
          );
        }, [context, stableInputs]);

        return useAtomValue(composed).map(({ atom, state }) => ({
          ...presentation(state.result),
          stale: state.stale,
          disconnected: state.disconnected,
          retry: () => registry.refresh(atom),
          refetch: () => registry.refresh(atom)
        }));
      },
      useQuery(input: unknown, options?: QueryOptions) {
        const context = useRpcContext();
        const atom =
          input === undefined || options?.enabled === false
            ? disabled
            : context.query(endpoint, input);
        const state = useLiveQuery(atom);

        return {
          ...presentation(state.result),
          stale: state.stale,
          disconnected: state.disconnected,
          retry: state.retry,
          refetch: state.retry
        };
      }
    };

  if (endpoint.kind === 'mutation')
    return {
      call: read,
      useMutation() {
        const { transport } = useRpcContext();
        const invoke = useMemo(
          () => (input: unknown) => transport.execute(endpoint.rpc, input),
          [transport]
        );
        const state = useIndependentMutation(invoke);

        return { ...state, ...presentation(state.result), isPending: state.pending > 0 };
      }
    };

  return { subscribe: (input: unknown) => transportForRead().subscribe(endpoint.rpc, input) };
}

const disabled = Atom.make<LiveState<unknown, unknown>>({
  result: AsyncResult.initial(),
  stale: true,
  disconnected: false
});

type QueryState<A, E> = ReturnType<typeof presentation<A, E>> & {
  readonly stale: boolean;
  readonly disconnected: boolean;
  readonly retry: () => void;
  readonly refetch: () => void;
};

type MutationState<I, A, E> = ReturnType<typeof presentation<A, E>> & {
  readonly variables?: I;
  readonly reset: () => void;
  readonly pending: number;
  readonly mutate: (input: I) => Promise<A>;
  readonly mutateAsync: (input: I) => Promise<A>;
};

type Bound<E extends Endpoint> = E['kind'] extends 'query'
  ? {
      readonly read: (
        input: Rpc.Payload<E['rpc']>,
        options?: RpcCallOptions
      ) => Promise<Rpc.Success<E['rpc']>>;
      readonly useQueries: (
        inputs: readonly (Rpc.Payload<E['rpc']> | undefined)[]
      ) => QueryState<
        Rpc.Success<E['rpc']>,
        Rpc.Error<E['rpc']> | RpcClientError | SubscriptionTimeout | SubscriptionDefect
      >[];
      readonly useQuery: (
        input: Rpc.Payload<E['rpc']> | undefined,
        options?: QueryOptions
      ) => QueryState<
        Rpc.Success<E['rpc']>,
        Rpc.Error<E['rpc']> | RpcClientError | SubscriptionTimeout | SubscriptionDefect
      >;
    }
  : E['kind'] extends 'mutation'
    ? {
        readonly call: (
          input: Rpc.Payload<E['rpc']>,
          options?: RpcCallOptions
        ) => Promise<Rpc.Success<E['rpc']>>;
        readonly useMutation: () => MutationState<
          Rpc.Payload<E['rpc']>,
          Rpc.Success<E['rpc']>,
          Rpc.Error<E['rpc']> | RpcClientError | MutationDefect
        >;
      }
    : {
        readonly subscribe: (
          input: Rpc.Payload<E['rpc']>
        ) => Stream.Stream<Rpc.SuccessChunk<E['rpc']>, Rpc.Error<E['rpc']> | RpcClientError>;
      };

type Facade<T> = { readonly [K in keyof T]: T[K] extends Endpoint ? Bound<T[K]> : Facade<T[K]> };

/** Reflection preserves the canonical keys; the sole assertion bridges mapped types and Object.fromEntries. */
function derive<T extends Record<string, Record<string, Endpoint>>>(inventory: T): Facade<T> {
  return Object.fromEntries(
    Object.entries(inventory).map(([feature, definitions]) => [
      feature,
      Object.fromEntries(
        Object.entries(definitions).map(([operation, endpoint]) => [operation, bind(endpoint)])
      )
    ])
  ) as Facade<T>;
}

export const rpc = derive(endpoints);
