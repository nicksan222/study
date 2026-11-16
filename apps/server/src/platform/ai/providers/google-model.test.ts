import { test } from '@study/testing';
import { Effect, Schema, Stream } from 'effect';
import { LanguageModel, Prompt, Tool, Toolkit } from 'effect/ai';

import { createGoogleModel } from './google-model.ts';

const candidate = (text: string, finishReason?: string) => ({
  candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }],
  usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 }
});

test.unit.stable(
  'Google sends native JSON schema and authenticates each request',
  async ({ expect }) => {
    let body: Record<string, unknown> = {};
    const peer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        expect(request.headers.get('x-goog-api-key')).toBe('secret');
        body = (await request.json()) as Record<string, unknown>;

        return Response.json(candidate('{"answer":"Hello"}', 'STOP'));
      }
    });

    try {
      const model = createGoogleModel({
        apiKey: 'secret',
        modelId: 'gemini-3-test',
        fetch: (_url, init) => fetch(peer.url, init)
      });
      const result = await Effect.runPromise(
        LanguageModel.generateObject({
          prompt: 'Hello',
          schema: Schema.Struct({ answer: Schema.String })
        }).pipe(Effect.provide(model))
      );

      expect(result.value).toEqual({ answer: 'Hello' });
      expect(body.generationConfig).toMatchObject({
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object' }
      });
    } finally {
      await peer.stop(true);
    }
  }
);

test.unit.stable(
  'Google rejects a truncated stream after emitting native text deltas',
  async ({ expect }) => {
    const peer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () =>
        new Response(`data: ${JSON.stringify(candidate('Hello'))}\n\n`, {
          headers: { 'content-type': 'text/event-stream' }
        })
    });

    try {
      const model = createGoogleModel({
        apiKey: 'secret',
        modelId: 'gemini-3-test',
        fetch: (_url, init) => fetch(peer.url, init)
      });
      const result = await Effect.runPromise(
        LanguageModel.streamText({ prompt: 'Hello' }).pipe(
          Stream.runCollect,
          Effect.provide(model),
          Effect.result
        )
      );

      expect(result._tag).toBe('Failure');
    } finally {
      await peer.stop(true);
    }
  }
);

test.unit.stable(
  'Google streams text and grounding URLs with terminal usage',
  async ({ expect }) => {
    const peer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () =>
        new Response(
          [
            candidate('Hello'),
            {
              ...candidate(' world', 'STOP'),
              candidates: [
                {
                  content: { parts: [{ text: ' world' }] },
                  finishReason: 'STOP',
                  groundingMetadata: {
                    groundingChunks: [
                      { web: { uri: 'https://example.com/source', title: 'Source' } }
                    ]
                  }
                }
              ]
            }
          ]
            .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
            .join(''),
          { headers: { 'content-type': 'text/event-stream' } }
        )
    });

    try {
      const model = createGoogleModel({
        apiKey: 'secret',
        modelId: 'gemini-3-test',
        fetch: (_url, init) => fetch(peer.url, init)
      });
      const parts = await Effect.runPromise(
        LanguageModel.streamText({ prompt: 'Hello' }).pipe(Stream.runCollect, Effect.provide(model))
      );

      expect(
        parts
          .filter((part) => part.type === 'text-delta')
          .map((part) => part.delta)
          .join('')
      ).toBe('Hello world');
      expect(parts.find((part) => part.type === 'source')).toMatchObject({
        sourceType: 'url',
        title: 'Source'
      });
      expect(parts.at(-1)).toMatchObject({
        type: 'finish',
        reason: 'stop',
        usage: { inputTokens: { total: 2 }, outputTokens: { total: 3 } }
      });
    } finally {
      await peer.stop(true);
    }
  }
);

test.unit.stable(
  'Google maps authentication errors to the native typed reason',
  async ({ expect }) => {
    const peer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => Response.json({ error: { message: 'invalid key' } }, { status: 401 })
    });

    try {
      const model = createGoogleModel({
        apiKey: 'secret',
        modelId: 'gemini-3-test',
        fetch: (_url, init) => fetch(peer.url, init)
      });
      const result = await Effect.runPromise(
        LanguageModel.generateText({ prompt: 'Hello' }).pipe(Effect.provide(model), Effect.result)
      );

      expect(result).toMatchObject({
        _tag: 'Failure',
        failure: { reason: { _tag: 'AuthenticationError' } }
      });
    } finally {
      await peer.stop(true);
    }
  }
);

test.unit.stable(
  'Google preserves typed function arguments, results and Gemini thought signatures',
  async ({ expect }) => {
    const lookup = Tool.make('lookup', {
      parameters: Schema.Struct({ query: Schema.String }),
      success: Schema.String
    });
    let step = 0;
    const peer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        const body = (await request.json()) as {
          contents: { parts: unknown[] }[];
          tools: unknown[];
        };

        expect(body.tools).toMatchObject([
          { functionDeclarations: [{ name: 'lookup', parametersJsonSchema: { type: 'object' } }] }
        ]);

        if (step++ === 0)
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: { name: 'lookup', args: { query: 'cats' } },
                      thoughtSignature: 'opaque-signed-thought'
                    }
                  ]
                },
                finishReason: 'STOP'
              }
            ]
          });

        expect(body.contents).toContainEqual({
          role: 'model',
          parts: [
            expect.objectContaining({
              functionCall: expect.objectContaining({ name: 'lookup', args: { query: 'cats' } }),
              thoughtSignature: 'opaque-signed-thought'
            })
          ]
        });
        expect(body.contents).toContainEqual({
          role: 'user',
          parts: [
            expect.objectContaining({
              functionResponse: expect.objectContaining({
                name: 'lookup',
                response: { output: 'found' }
              })
            })
          ]
        });

        return Response.json(candidate('Done', 'STOP'));
      }
    });

    try {
      const model = createGoogleModel({
        apiKey: 'secret',
        modelId: 'gemini-3-test',
        fetch: (_url, init) => fetch(peer.url, init)
      });
      const toolkit = Toolkit.make(lookup);
      const first = await Effect.runPromise(
        LanguageModel.generateText({
          prompt: 'Find cats',
          toolkit,
          disableToolCallResolution: true
        }).pipe(Effect.provide(model))
      );

      expect(first.toolCalls[0]?.params).toEqual({ query: 'cats' });
      const call = first.toolCalls[0]!;
      const prompt = Prompt.concat(
        Prompt.fromResponseParts(first.content),
        Prompt.make([
          Prompt.makeMessage('tool', {
            content: [
              Prompt.makePart('tool-result', {
                id: call.id,
                name: call.name,
                isFailure: false,
                providerExecuted: false,
                result: 'found'
              })
            ]
          })
        ])
      );
      const result = await Effect.runPromise(
        LanguageModel.generateText({ prompt, toolkit, disableToolCallResolution: true }).pipe(
          Effect.provide(model)
        )
      );

      expect(result.text).toBe('Done');
    } finally {
      await peer.stop(true);
    }
  }
);

test.unit.stable(
  'Google applies structured schemas to the native streaming request',
  async ({ expect }) => {
    const peer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        const body = (await request.json()) as { generationConfig: unknown };

        expect(body.generationConfig).toMatchObject({
          responseMimeType: 'application/json',
          responseJsonSchema: { type: 'object', required: ['answer'] }
        });

        return new Response(
          `data: ${JSON.stringify(candidate('{"answer":"Hello"}', 'STOP'))}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } }
        );
      }
    });

    try {
      const model = createGoogleModel({
        apiKey: 'secret',
        modelId: 'gemini-3-test',
        outputSchema: Schema.Struct({ answer: Schema.String }),
        fetch: (_url, init) => fetch(peer.url, init)
      });
      const parts = await Effect.runPromise(
        LanguageModel.streamText({ prompt: 'Hello' }).pipe(Stream.runCollect, Effect.provide(model))
      );

      expect(parts.find((part) => part.type === 'text-delta')).toMatchObject({
        delta: '{"answer":"Hello"}'
      });
    } finally {
      await peer.stop(true);
    }
  }
);
