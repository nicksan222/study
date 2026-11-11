/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Creates an Effect RPC client over the browser-safe HTTP transport. It resolves the │
 * │ host URL lazily and reuses the resolved endpoint for subsequent requests.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports StudyClientOptions, makeStudyClient, workflowSnapshots. It resolves the host   │
 * │   URL lazily and reuses the resolved endpoint for subsequent requests.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Consumes Study RPC contracts and Effect RPC APIs; caller scopes own network requests,    │
 * │ subscriptions, and cancellation.                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import type { Rpc, RpcGroup } from 'effect/rpc';

export type StudyClientOptions = {
  baseUrl: string | (() => string | Promise<string>);
};

/** Construct a scoped client. Failed discovery may be retried by a later call. */
export function makeStudyClient<R extends Rpc.Any>(
  group: RpcGroup.RpcGroup<R>,
  options: StudyClientOptions
) {
  let connection: Promise<string> | undefined;
  const discover = () => {
    if (!connection) {
      const pending = Promise.resolve().then(async () => {
        const base =
          typeof options.baseUrl === 'function' ? await options.baseUrl() : options.baseUrl;

        return `${base.replace(/\/$/, '')}/rpc`;
      });

      connection = pending;
      void pending.catch(() => {
        if (connection === pending) connection = undefined;
      });
    }

    return connection;
  };
  const fetchRpc: typeof fetch = new Proxy(globalThis.fetch, {
    apply: async (_target, _thisArg, [_input, init]: Parameters<typeof fetch>) => {
      const pending = discover();

      try {
        const url = await pending;

        return await globalThis.fetch(url, init);
      } catch (error) {
        if (connection === pending) connection = undefined;

        throw error;
      }
    }
  });
  const protocol = RpcClient.layerProtocolHttp({ url: 'http://study.invalid' }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchRpc))
  );

  return RpcClient.make(group).pipe(Effect.provide(protocol));
}

export { workflowSnapshots } from './reactivity.ts';
