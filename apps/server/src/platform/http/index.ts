/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides scoped HTTP fetching helpers for server integrations. It validates URLs   │
 * │ and redirects, bounds response size and time, supports streaming bytes, and maps         │
 * │ transport failures to StudyError.                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports FetchOptions, validateLink, fetchPage, requestBytes, runHttpPromise, and       │
 * │   related typed APIs. It validates URLs and redirects, bounds response size and time,    │
 * │   supports streaming bytes, and maps transport failures to StudyError.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ AI provider and source ingestion callers use this transport; request scope handles       │
 * │ cancellation and errors are returned as StudyError.                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { Clock, Effect, Stream } from 'effect';
import type { HttpClientResponse } from 'effect/http';
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from 'effect/http';

import { liveClock } from '#server/platform/time/index';

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  fetch?: typeof fetch;
}

export function validateLink(address: string): string {
  try {
    const url = new URL(address.trim());

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('unsupported URL');

    return address.trim();
  } catch {
    throw new StudyError(
      'invalid_input',
      'Only HTTP and HTTPS URLs without credentials are supported'
    );
  }
}

/** Bounded, scoped acquisition. Redirect targets are validated before dispatch. */
export function fetchPage(address: string, options: FetchOptions = {}) {
  const limit = options.maxBytes ?? 32 * 1024 * 1024;
  const redirects = options.maxRedirects ?? 5;
  const timeout = options.timeoutMs ?? 15_000;

  return Effect.gen(function* () {
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      !Number.isSafeInteger(redirects) ||
      redirects < 0 ||
      !Number.isSafeInteger(timeout) ||
      timeout <= 0
    )
      return yield* Effect.fail(new StudyError('invalid_input', 'Invalid fetch limits'));

    let url = yield* Effect.try({
      try: () => new URL(validateLink(address)),
      catch: () => new StudyError('invalid_input', 'Invalid URL')
    });
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);

    for (let count = 0; ; count++) {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const response = yield* client.execute(
            HttpClientRequest.get(url, {
              headers: { accept: 'text/html,application/xhtml+xml,text/plain,application/pdf,*/*' }
            })
          );

          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.location;

            if (!location || count >= redirects)
              return yield* Effect.fail(
                new StudyError('invalid_input', 'Invalid or excessive redirects')
              );

            const next = yield* Effect.try({
              try: () => new URL(validateLink(new URL(location, url).href)),
              catch: () => new StudyError('invalid_input', 'Invalid redirect URL')
            });

            return { tag: 'redirect', next } as const;
          }

          yield* checkPageStatus(response.status);

          const bytes = yield* readResponseBytes(
            response,
            limit,
            new StudyError('invalid_input', 'Page exceeds the size limit')
          );

          const mime = (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();

          return {
            tag: 'page',
            page: {
              url: url.href,
              bytes,
              mime: !mime || mime === 'application/xhtml+xml' ? 'text/html' : mime,
              name: url.pathname.split('/').pop() || url.hostname
            }
          } as const;
        })
      );

      if (result.tag === 'page') return result.page;

      url = result.next;
    }
  }).pipe(
    Effect.mapError((error) =>
      error instanceof StudyError
        ? error
        : new StudyError('transient', 'Page request failed', { cause: error })
    ),
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () => Effect.fail(new StudyError('transient', 'Page request timed out'))
    }),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }),
    Effect.provideService(FetchHttpClient.Fetch, options.fetch ?? globalThis.fetch)
  );
}

/** Send a form request and consume its response inside the request scope. */
export function requestBytes(
  address: string,
  options: { body: string; timeoutMs: number; maxBytes: number; fetch?: typeof fetch }
) {
  return Effect.scoped(
    Effect.gen(function* () {
      if (!validHttpLimits(options))
        return yield* Effect.fail(new StudyError('invalid_input', 'Invalid HTTP limits'));

      const client = HttpClient.withScope(yield* HttpClient.HttpClient);
      const request = HttpClientRequest.post(address).pipe(
        HttpClientRequest.setBody(
          HttpBody.raw(options.body, { contentType: 'application/x-www-form-urlencoded' })
        )
      );
      const response = yield* client.execute(request);
      const bytes = yield* readResponseBytes(
        response,
        options.maxBytes,
        new StudyError('transient', 'HTTP response exceeds the size limit')
      );

      return { status: response.status, bytes };
    })
  ).pipe(withHttpTransport(options));
}

/** Run HTTP effects at the Promise-only provider boundary. */
export function runHttpPromise<A, E>(
  effect: Effect.Effect<A, E>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  return Effect.runPromise(effect, options);
}

/** Promise/stream boundary for consumers such as the AI SDK. The scope outlives headers. */
export function streamingFetch(
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: { timeoutMs: number; maxBytes: number; fetch?: typeof fetch; clock?: Clock.Clock }
): Promise<Response> {
  const cancellation = new AbortController();
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const signal = callerSignal
    ? AbortSignal.any([cancellation.signal, callerSignal])
    : cancellation.signal;

  return new Promise((resolve, reject) => {
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    let settled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        output = controller;
      },
      cancel(reason) {
        cancellation.abort(reason);
      }
    });
    const program = Effect.scoped(
      Effect.gen(function* () {
        if (!validHttpLimits(options))
          return yield* Effect.fail(new StudyError('invalid_input', 'Invalid HTTP limits'));

        const webRequest = yield* Effect.try({
          try: () => new Request(input, init),
          catch: () => new StudyError('invalid_input', 'Invalid HTTP request')
        });
        const client = HttpClient.withScope(yield* HttpClient.HttpClient);
        const response = yield* client.execute(HttpClientRequest.fromWeb(webRequest));

        yield* checkResponseSize(
          response,
          options.maxBytes,
          new StudyError('transient', 'HTTP response exceeds the size limit')
        );

        const noBody = [204, 205, 304].includes(response.status);

        resolve(
          new Response(noBody ? null : body, { status: response.status, headers: response.headers })
        );
        settled = true;

        if (!noBody) {
          yield* Stream.runForEach(
            limitResponseBytes(
              response.stream,
              options.maxBytes,
              new StudyError('transient', 'HTTP response exceeds the size limit')
            ),
            (chunk) => Effect.sync(() => output?.enqueue(chunk))
          );
          output?.close();
        }
      })
    ).pipe(
      withHttpTransport(options),
      Effect.provideService(Clock.Clock, options.clock ?? liveClock())
    );

    void runHttpPromise(program, { signal }).catch((error: unknown) => {
      if (settled) {
        if (!cancellation.signal.aborted) output?.error(error);
      } else reject(signal.aborted ? signal.reason : error);
    });
  });
}

function validHttpLimits(options: { timeoutMs: number; maxBytes: number }) {
  return (
    Number.isSafeInteger(options.timeoutMs) &&
    options.timeoutMs > 0 &&
    Number.isSafeInteger(options.maxBytes) &&
    options.maxBytes > 0
  );
}

function withHttpTransport(options: { timeoutMs: number; fetch?: typeof fetch }) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof StudyError
          ? error
          : new StudyError('transient', 'HTTP request failed', { cause: error })
      ),
      Effect.timeoutOrElse({
        duration: options.timeoutMs,
        orElse: () => Effect.fail(new StudyError('transient', 'HTTP request timed out'))
      }),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'error' }),
      Effect.provideService(FetchHttpClient.Fetch, options.fetch ?? globalThis.fetch)
    );
}

function checkResponseSize(
  response: HttpClientResponse.HttpClientResponse,
  limit: number,
  error: StudyError
) {
  const declared = Number(response.headers['content-length']);

  return Number.isFinite(declared) && declared > limit ? Effect.fail(error) : Effect.void;
}

function readResponseBytes(
  response: HttpClientResponse.HttpClientResponse,
  limit: number,
  error: StudyError
) {
  return Effect.gen(function* () {
    yield* checkResponseSize(response, limit, error);
    const chunks: Uint8Array[] = [];

    yield* Stream.runForEach(limitResponseBytes(response.stream, limit, error), (chunk) => {
      chunks.push(chunk);

      return Effect.void;
    });
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return bytes;
  });
}

/** Bound cumulative bytes independently for each consumption of a response stream. */
function limitResponseBytes<E, R>(
  stream: Stream.Stream<Uint8Array, E, R>,
  limit: number,
  error: StudyError
) {
  return stream.pipe(
    Stream.mapAccumEffect(
      () => 0,
      (size, chunk) => {
        const total = size + chunk.byteLength;

        return total > limit ? Effect.fail(error) : Effect.succeed([total, [chunk]] as const);
      }
    )
  );
}

function checkPageStatus(status: number) {
  if (status < 200 || status >= 300)
    return Effect.fail(
      new StudyError(
        status === 429 ? 'rate_limited' : status >= 500 ? 'transient' : 'invalid_input',
        `Page request failed with HTTP ${status}`
      )
    );

  return Effect.void;
}
