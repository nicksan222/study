/** @file Native OpenAI Responses model using the signed-in ChatGPT plan and bounded OAuth transport. */
import { OpenAiClient, OpenAiLanguageModel, OpenAiSchema } from '@effect/ai-openai';
import { StudyError } from '@study/contracts';
import { Effect, Layer, Option, Schema, Stream } from 'effect';
import type { Clock } from 'effect';
import { AiError, Model, OpenAiStructuredOutput } from 'effect/ai';
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse
} from 'effect/http';

import { AiRequestCheck } from '#server/platform/ai/model';
import type { AiModel } from '#server/platform/ai/model';
import { requireAllowedAiModel } from '#server/platform/ai/providers/model-policy';
import { providerFetch } from '#server/platform/ai/providers/transport';

import type { ChatGptCredentials } from './session.ts';
import { chatGptTools } from './tools.ts';

export const chatGptApiUrl = 'https://api.openai.com/v1';

class ChatGptRequestError extends StudyError {
  readonly kind: 'auth' | 'rate_limited' | 'transient' | 'unsupported';

  constructor(kind: 'auth' | 'rate_limited' | 'transient' | 'unsupported') {
    super(kind, `ChatGPT request failed (${kind})`);
    this.name = 'ChatGptRequestError';
    this.kind = kind;
  }
}

async function waitForToken(
  auth: ChatGptCredentials,
  signal?: AbortSignal | null
): Promise<string> {
  if (!signal) return auth.token();

  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);

    signal.addEventListener('abort', abort, { once: true });
    auth
      .token()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));

    if (signal.aborted) abort();
  });
}

export type ChatGptModel = AiModel;

export interface ChatGptModelOptions {
  auth: ChatGptCredentials;
  modelId: string;
  baseUrl?: string;
  fetch?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
  clock?: Clock.Clock;
  outputSchema?: Schema.Top & Schema.ConstraintDecoder<unknown>;
}

function streamFailure() {
  return AiError.make({
    module: 'ChatGptModel',
    method: 'response',
    reason: new AiError.UnknownError({
      description: 'ChatGPT response incomplete or failed'
    })
  });
}

/** OpenAI's native decoder owns Responses SSE; this fence requires a successful terminal event. */
export function createChatGptModel({
  auth,
  modelId,
  baseUrl = chatGptApiUrl,
  fetch: request = globalThis.fetch,
  clock = auth.clock,
  outputSchema
}: ChatGptModelOptions): ChatGptModel {
  if (!modelId) throw new Error('A ChatGPT model ID is required');

  requireAllowedAiModel(modelId);

  const http = Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      return HttpClient.make((original) => chatHttpRequest(client, original, auth));
    })
  ).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, providerFetch({ fetch: request, clock }))),
    Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'error' }))
  );
  const clientLayer = Layer.effect(
    OpenAiClient.OpenAiClient,
    Effect.gen(function* () {
      const client = yield* OpenAiClient.make({ apiUrl: baseUrl });
      const createResponseStream: typeof client.createResponseStream = (payload) =>
        Effect.gen(function* () {
          const system: string[] = [];
          const input =
            typeof payload.input === 'string'
              ? payload.input
              : payload.input?.filter((item) => {
                  if ('role' in item && (item.role === 'system' || item.role === 'developer')) {
                    system.push(...systemText(item.content));

                    return false;
                  }

                  return true;
                });
          const [response, events] = yield* client.createResponseStream({
            ...payload,
            input,
            instructions: [payload.instructions, ...system].filter(Boolean).join('\n\n'),
            text: outputSchema
              ? {
                  ...payload.text,
                  format: {
                    type: 'json_schema',
                    name: 'response',
                    strict: true,
                    schema: OpenAiStructuredOutput.toCodecOpenAI(outputSchema).jsonSchema
                  }
                }
              : payload.text,
            store: false,
            temperature: undefined,
            top_p: undefined,
            max_output_tokens: undefined
          });
          let completed = false;

          return [
            response,
            events.pipe(
              Stream.mapEffect((event) => {
                if (event.type === 'error') return Effect.fail(streamFailure());

                if (
                  event.type === 'response.failed' &&
                  event.response &&
                  typeof event.response === 'object'
                )
                  return Effect.succeed({
                    ...event,
                    response: { ...event.response, error: undefined }
                  });

                if (event.type === 'response.completed') completed = true;

                return Effect.succeed(event);
              }),
              Stream.concat(
                Stream.fromEffect(
                  Effect.suspend(() => (completed ? Effect.void : Effect.fail(streamFailure())))
                ).pipe(Stream.drain)
              )
            )
          ] as const;
        });

      return {
        ...client,
        createResponseStream,
        createResponse: (payload) =>
          Effect.gen(function* () {
            const [response, events] = yield* createResponseStream(payload);
            const terminal = yield* Stream.runCollect(
              events.pipe(Stream.filter((event) => event.type === 'response.completed'))
            );
            const completed = terminal[0];

            if (!completed || completed.type !== 'response.completed')
              return yield* Effect.fail(streamFailure());

            const body = yield* Schema.decodeUnknownEffect(OpenAiSchema.Response)(
              completed.response
            ).pipe(Effect.mapError(() => streamFailure()));

            return [body, response] as const;
          })
      } satisfies typeof client;
    })
  ).pipe(Layer.provide(http));

  return Object.assign(
    Model.make(
      'chatgpt' as string,
      modelId,
      OpenAiLanguageModel.layer({ model: modelId, config: { store: false } }).pipe(
        Layer.provide(clientLayer)
      )
    ),
    {
      providerTools: chatGptTools,
      withOutputSchema: (schema: Schema.Top & Schema.ConstraintDecoder<unknown>) => ({
        model: createChatGptModel({
          auth,
          modelId,
          baseUrl,
          fetch: request,
          clock,
          outputSchema: schema
        }),
        codec: OpenAiStructuredOutput.toCodecOpenAI(schema).codec
      })
    }
  );
}

function systemText(content: unknown): string[] {
  if (typeof content === 'string') return [content];

  if (!Array.isArray(content)) return [];

  return content.flatMap((part: unknown) =>
    part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
      ? [part.text]
      : []
  );
}

function chatHttpRequest(
  client: HttpClient.HttpClient,
  original: HttpClientRequest.HttpClientRequest,
  auth: ChatGptCredentials
) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = yield* Effect.tryPromise({
        try: (signal) => waitForToken(auth, signal),
        catch: (cause) => cause
      });

      yield* yield* AiRequestCheck;
      const outgoing = original.pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeader('accept', 'text/event-stream')
      );
      const response = yield* client.execute(outgoing);

      if (response.status === 401 && attempt === 0) {
        yield* Effect.tryPromise({
          try: async () => {
            await Option.getOrUndefined(HttpClientResponse.toWeb(response))?.body?.cancel();
          },
          catch: (cause) => cause
        });
        auth.refused(token);
        continue;
      }

      if (response.status >= 200 && response.status < 300) return response;

      const code = yield* Effect.tryPromise({
        try: () => responseErrorCode(Option.getOrThrow(HttpClientResponse.toWeb(response))),
        catch: (cause) => cause
      });

      return yield* Effect.fail(new ChatGptRequestError(requestFailureKind(code, response.status)));
    }

    return yield* Effect.fail(new ChatGptRequestError('auth'));
  }).pipe(
    Effect.catch((cause) =>
      cause instanceof StudyError
        ? Effect.die(cause)
        : Effect.fail(
            cause instanceof HttpClientError.HttpClientError
              ? cause
              : new HttpClientError.HttpClientError({
                  reason: new HttpClientError.TransportError({ request: original, cause })
                })
          )
    )
  );
}

async function responseErrorCode(response: Response) {
  let code = '';

  try {
    const body = (await response.json()) as {
      error?: { code?: unknown };
    };

    if (typeof body?.error?.code === 'string') code = body.error.code;
  } catch {
    /* Body is intentionally discarded. */
  }

  return code;
}

function requestFailureKind(code: string, status: number) {
  const known = [
    'subscription_sharing_usage_limit_exceeded',
    'subscription_sharing_invalid_user',
    'subscription_sharing_user_not_eligible',
    'subscription_sharing_unsupported_capability'
  ].includes(code)
    ? code
    : 'request_failed';
  const kind =
    known === 'subscription_sharing_usage_limit_exceeded' || status === 429
      ? 'rate_limited'
      : known === 'subscription_sharing_unsupported_capability'
        ? 'unsupported'
        : [401, 403].includes(status) ||
            known === 'subscription_sharing_invalid_user' ||
            known === 'subscription_sharing_user_not_eligible'
          ? 'auth'
          : 'transient';

  return kind;
}
