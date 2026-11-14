/** Host discovery stays in application composition; schemas own transport validation. */
import type { ProtocolTransport } from '@study/contracts/react';
import { makeStudyClient, studySocketProtocol } from '@study/server/client';
import { Effect, Layer, Stream } from 'effect';
import { RpcClient, RpcGroup } from 'effect/rpc';
import type { Rpc } from 'effect/rpc';
import type { RpcClientError } from 'effect/rpc/RpcClientError';

import { rpcBaseUrl } from '../host.ts';

/** One identity per connection/security context; providers must replace it when that context changes. */
export function createRpcTransport(): ProtocolTransport {
  const protocol = studySocketProtocol({ baseUrl: rpcBaseUrl });
  const memoMap = Layer.makeMemoMapUnsafe();

  function invocation<R extends Rpc.AnyWithProps>(definition: R, live = false) {
    const group = RpcGroup.make(definition);
    const client = live
      ? Effect.gen(function* () {
          const scope = yield* Effect.scope;
          const services = yield* Layer.buildWithMemoMap(protocol, memoMap, scope);

          return yield* RpcClient.make(group).pipe(Effect.provide(services));
        })
      : makeStudyClient(group, { baseUrl: rpcBaseUrl });

    // The single-definition client has exactly this schema-validated method. Generic mapped
    // key correlation is erased by TypeScript; this assertion stays at the transport boundary.
    return Effect.map(
      client,
      (value) =>
        value[definition._tag as keyof typeof value] as (
          input: Rpc.AnyWithProps extends R ? unknown : Rpc.Payload<R>
        ) =>
          | Effect.Effect<Rpc.Success<R>, Rpc.Error<R> | RpcClientError>
          | Stream.Stream<Rpc.SuccessChunk<R>, Rpc.Error<R> | RpcClientError>
    );
  }

  return {
    execute: <R extends Rpc.AnyWithProps>(
      definition: R,
      input: Rpc.AnyWithProps extends R ? unknown : Rpc.Payload<R>
    ) =>
      Effect.scoped(
        Effect.flatMap(invocation(definition), (invoke) => {
          const result = invoke(input);

          if (!Effect.isEffect(result)) throw new TypeError('Expected a unary RPC definition');

          return result;
        })
      ),
    subscribe: <R extends Rpc.AnyWithProps>(
      definition: R,
      input: Rpc.AnyWithProps extends R ? unknown : Rpc.Payload<R>
    ) =>
      Stream.unwrap(
        Effect.map(invocation(definition, true), (invoke) => {
          const result = invoke(input);

          if (!Stream.isStream(result)) throw new TypeError('Expected a streaming RPC definition');

          return result;
        })
      )
  };
}
