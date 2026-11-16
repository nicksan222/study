/** @file Implements Gemini generateContent requests, native tools and validated streaming through Effect AI. */
import { Effect, Layer, Schema, Stream } from 'effect';
import { AiError, LanguageModel, Model, Tool } from 'effect/ai';
import type { Prompt, Response as AiResponse } from 'effect/ai';
import { Base64, Sse } from 'effect/encoding';
import { HttpClient, HttpClientError, HttpClientRequest } from 'effect/http';

import type { AiModel } from '#server/platform/ai/model';

import { providerHttpLayer } from './transport.ts';
import type { TransportOptions } from './transport.ts';

const googleSearch = Tool.providerDefined({
  id: 'google.google_search',
  customName: 'web_search',
  providerName: 'google_search'
})(undefined);

const Chunk = Schema.Struct({
  candidates: Schema.optional(
    Schema.Array(
      Schema.Struct({
        content: Schema.optional(
          Schema.Struct({
            parts: Schema.Array(
              Schema.Struct({
                text: Schema.optional(Schema.String),
                thought: Schema.optional(Schema.Boolean),
                thoughtSignature: Schema.optional(Schema.String),
                functionCall: Schema.optional(
                  Schema.Struct({
                    name: Schema.String,
                    args: Schema.Unknown,
                    id: Schema.optional(Schema.String)
                  })
                )
              })
            )
          })
        ),
        finishReason: Schema.optional(Schema.String),
        groundingMetadata: Schema.optional(
          Schema.Struct({
            groundingChunks: Schema.optional(
              Schema.Array(
                Schema.Struct({
                  web: Schema.optional(
                    Schema.Struct({ uri: Schema.String, title: Schema.optional(Schema.String) })
                  )
                })
              )
            )
          })
        )
      })
    )
  ),
  usageMetadata: Schema.optional(
    Schema.Struct({
      promptTokenCount: Schema.optional(Schema.Int),
      candidatesTokenCount: Schema.optional(Schema.Int),
      cachedContentTokenCount: Schema.optional(Schema.Int),
      thoughtsTokenCount: Schema.optional(Schema.Int)
    })
  )
});

type Chunk = typeof Chunk.Type;

function invalid(description: string) {
  return AiError.make({
    module: 'GoogleLanguageModel',
    method: 'generateContent',
    reason: new AiError.InvalidResponseError({ description })
  });
}

function failure(cause: unknown) {
  if (AiError.isAiError(cause)) return cause;

  if (
    HttpClientError.isHttpClientError(cause) &&
    (cause.reason._tag === 'TransportError' ||
      cause.reason._tag === 'EncodeError' ||
      cause.reason._tag === 'InvalidUrlError')
  ) {
    return AiError.make({
      module: 'GoogleLanguageModel',
      method: 'generateContent',
      reason: AiError.NetworkError.fromRequestError(cause.reason)
    });
  }

  return invalid(String(cause));
}

function requestPart(
  part: Prompt.UserMessagePart | Prompt.AssistantMessagePart | Prompt.ToolMessagePart
): unknown {
  switch (part.type) {
    case 'text':
      return { text: part.text };
    case 'file':
      return part.data instanceof URL
        ? { fileData: { mimeType: part.mediaType, fileUri: String(part.data) } }
        : {
            inlineData: {
              mimeType: part.mediaType,
              data: typeof part.data === 'string' ? part.data : Base64.encode(part.data)
            }
          };
    case 'tool-call':
      return {
        functionCall: { name: part.name, args: part.params, id: part.id },
        ...(typeof part.options.google === 'object' && part.options.google !== null
          ? part.options.google
          : {})
      };
    case 'tool-result':
      return {
        functionResponse: {
          name: part.name,
          id: part.id,
          response: { [part.isFailure ? 'error' : 'output']: part.result }
        }
      };
    default:
      return undefined;
  }
}

function requestTools(options: LanguageModel.ProviderOptions) {
  const declarations = options.tools
    .filter((tool) => !Tool.isProviderDefined(tool))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema:
        Tool.isDynamic(tool) && tool.jsonSchema !== undefined
          ? tool.jsonSchema
          : LanguageModel.defaultCodecTransformer(tool.parametersSchema).jsonSchema
    }));
  const tools: unknown[] = [];

  if (declarations.length > 0) tools.push({ functionDeclarations: declarations });

  if (
    options.tools.some((tool) => Tool.isProviderDefined(tool) && tool.id === 'google.google_search')
  )
    tools.push({ googleSearch: {} });

  return { tools, declarations };
}

function toolConfiguration(choice: LanguageModel.ProviderOptions['toolChoice']) {
  const mode =
    choice === 'none'
      ? 'NONE'
      : choice === 'required' ||
          (typeof choice === 'object' && ('tool' in choice || choice.mode === 'required'))
        ? 'ANY'
        : 'AUTO';
  const allowedFunctionNames =
    typeof choice === 'object' ? ('tool' in choice ? [choice.tool] : choice.oneOf) : undefined;

  return {
    functionCallingConfig: { mode, ...(allowedFunctionNames ? { allowedFunctionNames } : {}) }
  };
}

function requestBody(options: LanguageModel.ProviderOptions) {
  const contents: unknown[] = [];
  const system: { text: string }[] = [];

  for (const message of options.prompt.content) {
    if (message.role === 'system') system.push({ text: message.content });
    else
      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: message.content.map(requestPart).filter((part) => part !== undefined)
      });
  }

  const { tools, declarations } = requestTools(options);

  return {
    contents,
    ...(system.length ? { systemInstruction: { parts: system } } : {}),
    ...(tools.length ? { tools } : {}),
    ...(declarations.length ? { toolConfig: toolConfiguration(options.toolChoice) } : {}),
    ...(options.responseFormat.type === 'json'
      ? {
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: LanguageModel.defaultCodecTransformer(options.responseFormat.schema)
              .jsonSchema
          }
        }
      : {})
  };
}

type Candidate = NonNullable<Chunk['candidates']>[number];

type CandidatePart = NonNullable<Candidate['content']>['parts'][number];

function responseContent(part: CandidatePart): AiResponse.PartEncoded[] {
  const result: AiResponse.PartEncoded[] = [];

  if (part.text) result.push({ type: part.thought ? 'reasoning' : 'text', text: part.text });

  if (part.functionCall)
    result.push({
      type: 'tool-call',
      id: part.functionCall.id ?? crypto.randomUUID(),
      name: part.functionCall.name,
      params: part.functionCall.args,
      ...(part.thoughtSignature
        ? { metadata: { google: { thoughtSignature: part.thoughtSignature } } }
        : {})
    });

  return result;
}

function responseParts(chunk: Chunk): AiResponse.PartEncoded[] {
  const candidate = chunk.candidates?.[0];
  const content = (candidate?.content?.parts ?? []).flatMap(responseContent);
  const sources: AiResponse.PartEncoded[] = (
    candidate?.groundingMetadata?.groundingChunks ?? []
  ).flatMap((chunk) =>
    chunk.web
      ? [
          {
            type: 'source',
            sourceType: 'url',
            id: chunk.web.uri,
            url: chunk.web.uri,
            title: chunk.web.title ?? chunk.web.uri
          }
        ]
      : []
  );

  return [...content, ...sources];
}

interface StreamState {
  terminal?: Chunk;
  hasTools: boolean;
  open: Set<'text' | 'reasoning'>;
}

function streamPart(
  part: AiResponse.PartEncoded,
  state: StreamState
): AiResponse.StreamPartEncoded[] {
  if (part.type !== 'text' && part.type !== 'reasoning') {
    if (part.type === 'tool-call') state.hasTools = true;

    return [part];
  }

  const result: AiResponse.StreamPartEncoded[] = [];

  if (!state.open.has(part.type)) {
    state.open.add(part.type);
    result.push({ type: part.type === 'text' ? 'text-start' : 'reasoning-start', id: part.type });
  }

  result.push({
    type: part.type === 'text' ? 'text-delta' : 'reasoning-delta',
    id: part.type,
    delta: part.text
  });

  return result;
}

function streamChunk(chunk: Chunk, state: StreamState) {
  if (chunk.candidates?.[0]?.finishReason) state.terminal = chunk;
  else if (state.terminal && chunk.usageMetadata)
    state.terminal = { ...state.terminal, usageMetadata: chunk.usageMetadata };

  return Stream.fromIterable(responseParts(chunk).flatMap((part) => streamPart(part, state)));
}

function streamEnd(state: StreamState) {
  return Effect.suspend(() => {
    if (!state.terminal) return Effect.fail(invalid('Gemini stream ended without a finish reason'));

    const end: AiResponse.StreamPartEncoded[] = [...state.open].map((type) => ({
      type: type === 'text' ? 'text-end' : 'reasoning-end',
      id: type
    }));

    end.push(finish(state.terminal, state.hasTools));

    return Effect.succeed(Stream.fromIterable(end));
  });
}

function finish(chunk: Chunk, toolCalls: boolean): AiResponse.FinishPartEncoded {
  const reason = chunk.candidates?.[0]?.finishReason;
  const usage = chunk.usageMetadata;

  return {
    type: 'finish',
    reason: toolCalls
      ? 'tool-calls'
      : reason === 'STOP'
        ? 'stop'
        : reason === 'MAX_TOKENS'
          ? 'length'
          : 'content-filter',
    usage: {
      inputTokens: { total: usage?.promptTokenCount, cacheRead: usage?.cachedContentTokenCount },
      outputTokens: { total: usage?.candidatesTokenCount, reasoning: usage?.thoughtsTokenCount }
    }
  };
}

export function createGoogleModel(
  options: TransportOptions & {
    modelId: string;
    outputSchema?: Schema.Top & Schema.ConstraintDecoder<unknown>;
  }
): AiModel {
  const layer = Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const request = (input: LanguageModel.ProviderOptions, streaming: boolean) =>
        Effect.gen(function* () {
          const endpoint = streaming ? 'streamGenerateContent?alt=sse' : 'generateContent';
          const req = HttpClientRequest.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.modelId)}:${endpoint}`
          ).pipe(
            HttpClientRequest.bodyJson(
              requestBody(
                options.outputSchema
                  ? {
                      ...input,
                      responseFormat: {
                        type: 'json',
                        objectName: 'output',
                        schema: options.outputSchema
                      }
                    }
                  : input
              )
            )
          );
          const response = yield* client.execute(yield* req);

          if (response.status >= 400) {
            return yield* Effect.fail(
              AiError.make({
                module: 'GoogleLanguageModel',
                method: endpoint,
                reason: AiError.reasonFromHttpStatus({ status: response.status })
              })
            );
          }

          return response;
        }).pipe(Effect.mapError(failure));

      return yield* LanguageModel.make({
        generateText: (input) =>
          Effect.gen(function* () {
            const response = yield* request(input, false);
            const chunk = yield* Schema.decodeUnknownEffect(Chunk)(yield* response.json).pipe(
              Effect.mapError(failure)
            );

            if (!chunk.candidates?.[0]?.finishReason)
              return yield* Effect.fail(invalid('Gemini response ended without a finish reason'));

            const parts = responseParts(chunk);

            return [
              ...parts,
              finish(
                chunk,
                parts.some((part) => part.type === 'tool-call')
              )
            ];
          }).pipe(Effect.mapError(failure)),
        streamText: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const response = yield* request(input, true);
              const state: StreamState = { hasTools: false, open: new Set() };
              const chunks = response.stream.pipe(
                Stream.decodeText(),
                Stream.pipeThroughChannel(Sse.decode()),
                Stream.mapEffect((event) =>
                  Effect.try({ try: () => JSON.parse(event.data) as unknown, catch: failure })
                ),
                Stream.mapEffect((value) => Schema.decodeUnknownEffect(Chunk)(value)),
                Stream.flatMap((chunk) => streamChunk(chunk, state))
              );

              return chunks.pipe(
                Stream.concat(Stream.unwrap(streamEnd(state))),
                Stream.mapError(failure)
              );
            })
          )
      });
    })
  ).pipe(Layer.provide(providerHttpLayer(options, 'x-goog-api-key')));

  return Object.assign(Model.make('google', options.modelId, layer), {
    providerTools: { web_search: googleSearch },
    supportsMixedTools: options.modelId.startsWith('gemini-3'),
    withOutputSchema: (schema: Schema.Top & Schema.ConstraintDecoder<unknown>) => ({
      model: createGoogleModel({ ...options, outputSchema: schema }),
      codec: LanguageModel.defaultCodecTransformer(schema).codec
    })
  });
}
