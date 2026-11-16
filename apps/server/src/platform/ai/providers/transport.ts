/** @file Native provider HTTP middleware resolves credentials and fences requests before transport. */
import { StudyError } from '@study/contracts';
import type { Clock } from 'effect';
import { Effect, Layer } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from 'effect/http';

import { AiRequestCheck } from '#server/platform/ai/model';
import { streamingFetch } from '#server/platform/http/index';

export interface TransportOptions {
  apiKey: string;
  resolveApiKey?: Effect.Effect<string, StudyError>;
  fetch?: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>;
}

export function providerHttpLayer(options: TransportOptions, header = 'authorization') {
  return Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      return HttpClient.mapRequestEffect(client, (request) =>
        Effect.gen(function* () {
          const key = options.resolveApiKey ? yield* options.resolveApiKey : options.apiKey;

          yield* yield* AiRequestCheck;

          return HttpClientRequest.setHeader(
            request,
            header,
            header === 'authorization' ? `Bearer ${key}` : key
          );
        }).pipe(
          // Native provider HTTP mappers discard transport causes; the runner preserves canonical failures.
          Effect.catch((cause) =>
            cause instanceof StudyError
              ? Effect.die(cause)
              : Effect.fail(
                  new HttpClientError.HttpClientError({
                    reason: new HttpClientError.TransportError({ request, cause })
                  })
                )
          )
        )
      );
    })
  ).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'error' })),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, providerFetch(options)))
  );
}

/** Reuses the bounded Effect transport while retaining runtime fetch properties. */
export function providerFetch(
  options: Pick<TransportOptions, 'fetch'> & { clock?: Clock.Clock }
): typeof globalThis.fetch {
  return new Proxy(globalThis.fetch, {
    apply: (_target, _receiver, [input, init]: Parameters<typeof globalThis.fetch>) =>
      streamingFetch(input, init, {
        fetch: options.fetch,
        timeoutMs: 120_000,
        maxBytes: 32 * 1024 * 1024,
        clock: options.clock
      })
  });
}
