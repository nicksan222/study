import { StudyError } from '@study/contracts/errors';
import type { Failure } from '@study/contracts/errors';
import { Effect, Stream, Queue } from 'effect';
import type { Layer, Scope } from 'effect';
import type { RpcGroup } from 'effect/rpc';
import { Rpc, RpcSchema } from 'effect/rpc';

type DomainError<E> = E | (Failure extends E ? StudyError : never);

type DomainResult<A> =
  A extends Rpc.Wrapper<infer V>
    ? Rpc.Wrapper<DomainResult<V>>
    : A extends Effect.Effect<infer V, infer E, infer R>
      ? Effect.Effect<
          V extends Queue.Dequeue<infer A, infer QE> ? Queue.Dequeue<A, DomainError<QE>> : V,
          DomainError<E>,
          R
        >
      : A extends Stream.Stream<infer V, infer E, infer R>
        ?
            | Stream.Stream<V, DomainError<E>, R>
            | Effect.Effect<Stream.Stream<V, DomainError<E>, R>, DomainError<E>, R>
        : never;

type Handlers<R extends Rpc.Any> = {
  readonly [Current in R as Current['_tag']]: (
    ...args: Parameters<Rpc.ToHandlerFn<Current>>
  ) => DomainResult<ReturnType<Rpc.ToHandlerFn<Current>>>;
};

type NativeResult<A> =
  A extends Rpc.Wrapper<infer V>
    ? Rpc.Wrapper<NativeResult<V>>
    : A extends Effect.Effect<Stream.Stream<infer V, infer SE, infer SR>, infer E, infer R>
      ? Stream.Stream<V, SE | E, SR | R>
      : A;

type NativeHandlers<H> = {
  [K in keyof H]: H[K] extends (...args: infer A) => infer V
    ? (...args: A) => NativeResult<V>
    : never;
};

function failure<E>(error: E): Exclude<E, StudyError> | Failure {
  return error instanceof StudyError
    ? { kind: error.kind, message: error.message, retryAfterMs: error.retryAfterMs }
    : (error as Exclude<E, StudyError>);
}

function mapResult(
  streaming: boolean,
  result: Effect.Effect<unknown, unknown, unknown> | Stream.Stream<unknown, unknown, unknown>
) {
  if (Stream.isStream(result)) return Stream.mapError(result, failure);

  if (streaming) {
    return Stream.unwrap(
      Effect.map(result, (value) =>
        Queue.isDequeue(value)
          ? Stream.fromQueue(value)
          : (value as Stream.Stream<unknown, unknown, unknown>)
      )
    ).pipe(Stream.mapError(failure));
  }

  return Effect.mapError(result, failure);
}

/** Build scoped native RPC handlers and translate only StudyError at the wire boundary. */
export function defineRpc<R extends Rpc.Any, H extends Handlers<R>, E, Init>(
  group: RpcGroup.RpcGroup<R>,
  makeHandlers: Effect.Effect<H & Record<Exclude<keyof H, R['_tag']>, never>, E, Init>
): Layer.Layer<
  Rpc.ToHandler<R>,
  E,
  Exclude<Init, Scope.Scope> | RpcGroup.HandlersServices<R, NativeHandlers<H>>
> {
  const handlers = Effect.map(makeHandlers, (input) => {
    const mapped = Object.fromEntries(
      Object.entries(input).map(([tag, handler]) => {
        // The public mapped type checks each tag against its native payload and result.
        const invoke = handler as (
          ...args: readonly unknown[]
        ) => Rpc.WrapperOr<
          Effect.Effect<unknown, unknown, unknown> | Stream.Stream<unknown, unknown, unknown>
        >;
        const request = group.requests.get(tag);

        if (!Rpc.isRpc(request)) throw new TypeError(`Unknown RPC handler: ${tag}`);

        const streaming = request.successSchema;

        return [
          tag,
          (...args: readonly unknown[]) =>
            Rpc.wrapMap(invoke(...args), (result) => {
              return mapResult(RpcSchema.isStreamSchema(streaming), result);
            })
        ];
      })
    );

    // Object.entries loses the association between the tag and its checked handler.
    return mapped as RpcGroup.HandlersFrom<R>;
  });

  return group.toLayer(handlers) as Layer.Layer<
    Rpc.ToHandler<R>,
    E,
    Exclude<Init, Scope.Scope> | RpcGroup.HandlersServices<R, NativeHandlers<H>>
  >;
}
