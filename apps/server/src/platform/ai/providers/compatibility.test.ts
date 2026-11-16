import { StudyError } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks provider registration, public metadata and Effect model construction without   │
 * │ live credentials.                                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises all registered providers and rejects unknown provider identifiers.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use production provider factories; no external provider calls are required here.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Schema, Stream } from 'effect';
import { LanguageModel, OpenAiStructuredOutput, Tool, Toolkit } from 'effect/ai';

import { webSearchTool } from '#server/platform/ai/web-search-tool';

import { createApiKeyModel } from './api-key-model.ts';
import { apiKeyProviders, getApiKeyProvider } from './registry.ts';
import { adaptProviderTool } from './tools.ts';

test.unit.stable(
  'compatible providers stream schema-validated JSON without requiring strict JSON Schema',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;
    let body: { response_format?: unknown; messages: unknown[]; tools: unknown[] } | undefined;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (req) => {
        let events = '';
        const requestBody = await req.text();

        body = JSON.parse(requestBody);
        const base = {
          id: 'test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test-model'
        };

        events += `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '{"answer":"Hello"}' }, finish_reason: null }] })}\n\n`;
        events += `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`;

        if (!JSON.parse(requestBody).stream)
          return Response.json({
            id: 'test',
            object: 'chat.completion',
            created: 1,
            model: 'test-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '{"answer":"Hello"}' },
                finish_reason: 'stop'
              }
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          });

        return new Response(events + 'data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' }
        });
      }
    });
    const address = { port: server.port };

    expect(address).not.toBeNull();
    const base = `http://127.0.0.1:${(address as { port: number }).port}`;
    const schema = Schema.Struct({ answer: Schema.String });

    try {
      for (const provider of apiKeyProviders.filter(
        (entry) => !['anthropic', 'google'].includes(entry.id)
      )) {
        const model = provider.createModel({
          apiKey: 'test-secret',
          modelId: 'test-model',
          fetch: (_url, init) => fetch(base, init)
        });
        const toolkit = Toolkit.make(
          Tool.make('sources', {
            description: 'Read captured sources',
            parameters: Schema.Struct({ query: Schema.String }),
            success: Schema.String
          })
        );
        const handlers = toolkit.toLayer({ sources: () => Effect.succeed('Captured source') });
        const result = await Effect.runPromise(
          LanguageModel.generateObject({ prompt: 'Answer in JSON.', schema, toolkit }).pipe(
            Effect.provide(model),
            Effect.provide(handlers)
          )
        );

        expect(result.value).toStrictEqual({ answer: 'Hello' });
        const prepared = model.withOutputSchema?.(schema);

        assert.ok(prepared);

        const parts = await Effect.runPromise(
          LanguageModel.streamText({ prompt: 'Answer in JSON.', toolkit }).pipe(
            Stream.runCollect,
            Effect.provide(prepared.model),
            Effect.provide(handlers)
          )
        );
        const text = parts
          .flatMap((part) => (part.type === 'text-delta' ? [part.delta] : []))
          .join('');

        expect(Schema.decodeUnknownSync(prepared.codec)(JSON.parse(text))).toStrictEqual({
          answer: 'Hello'
        });
        expect(body?.tools).toHaveLength(1);
        expect(body?.response_format).toStrictEqual({ type: 'json_object' });
        assert.ok(body);
        const instruction = Schema.decodeUnknownSync(
          Schema.Struct({ role: Schema.Literal('system'), content: Schema.String })
        )(body.messages[0]);
        const embedded = JSON.parse(instruction.content.split('\n').slice(1).join('\n'));

        expect(embedded).toStrictEqual(OpenAiStructuredOutput.toCodecOpenAI(schema).jsonSchema);
        expect(embedded).toMatchObject({
          type: 'object',
          properties: { answer: { type: 'string' } }
        });
      }
    } finally {
      await server.stop(true);
    }
  }
);

test.unit.stable(
  'Gemini 2 keeps function tools without mixing incompatible grounding tools',
  ({ expect }) => {
    const legacy = getApiKeyProvider('google').createModel({
      apiKey: 'test-key',
      modelId: 'gemini-2.5-flash'
    });
    const current = getApiKeyProvider('google').createModel({
      apiKey: 'test-key',
      modelId: 'gemini-3.6-flash'
    });

    expect(adaptProviderTool(legacy, webSearchTool)).toBeDefined();
    expect(adaptProviderTool(legacy, webSearchTool, true)).toBeUndefined();
    expect(adaptProviderTool(current, webSearchTool, true)).toBeDefined();
  }
);

test.unit.stable(
  'queued models resolve replacement keys on each call and reject removed keys before transport',
  async ({ expect }) => {
    let key: string | undefined = 'first-key';
    const seen: string[] = [];
    const model = createApiKeyModel(
      getApiKeyProvider('deepseek'),
      'deepseek-flash',
      Effect.suspend(() =>
        key ? Effect.succeed(key) : Effect.fail(new StudyError('auth', 'Key removed'))
      ),
      async (_url, init) => {
        seen.push(new Headers(init?.headers).get('authorization') ?? '');

        throw new StudyError('transient', 'Test transport');
      }
    );

    key = 'replacement-key';
    await expect(
      Effect.runPromise(LanguageModel.generateText({ prompt: 'Hello' }).pipe(Effect.provide(model)))
    ).rejects.toThrow();
    expect(seen).toStrictEqual(['Bearer replacement-key']);
    key = undefined;
    await expect(
      Effect.runPromise(
        LanguageModel.streamText({ prompt: 'Hello' }).pipe(Stream.runCollect, Effect.provide(model))
      )
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
  }
);

test.unit.stable(
  'API-key models use bounded HTTP bodies and reject redirects',
  async ({ expect }) => {
    let redirect: RequestRedirect | undefined;
    const model = createApiKeyModel(
      getApiKeyProvider('deepseek'),
      'deepseek-flash',
      Effect.succeed('test-key'),
      async (_url, init) => {
        redirect = init?.redirect;

        return new Response('{}', {
          headers: {
            'content-type': 'application/json',
            'content-length': String(32 * 1024 * 1024 + 1)
          }
        });
      }
    );

    await expect(
      Effect.runPromise(LanguageModel.generateText({ prompt: 'Hello' }).pipe(Effect.provide(model)))
    ).rejects.toThrow();
    expect(redirect).toBe('error');
  }
);

test.unit.stable(
  'Anthropic streams structured output with the native output format',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;
    let body: { output_config?: { format?: { type: string; schema: unknown } } } | undefined;
    const model = getApiKeyProvider('anthropic').createModel({
      apiKey: 'test-key',
      modelId: 'claude-sonnet-5-5',
      fetch: async (_url, init) => {
        body = await new Request(_url, init).json();
        const events = [
          {
            type: 'message_start',
            message: {
              id: 'msg',
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-5-5',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 0 }
            }
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '{"answer":"Hello"}' }
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 1 }
          },
          { type: 'message_stop' }
        ];

        return new Response(
          events
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(''),
          { headers: { 'content-type': 'text/event-stream' } }
        );
      }
    });
    const prepared = model.withOutputSchema?.(Schema.Struct({ answer: Schema.String }));

    assert.ok(prepared);

    const parts = await Effect.runPromise(
      LanguageModel.streamText({ prompt: 'Answer.' }).pipe(
        Stream.runCollect,
        Effect.provide(prepared.model)
      )
    );
    const text = parts.flatMap((part) => (part.type === 'text-delta' ? [part.delta] : [])).join('');

    expect(Schema.decodeUnknownSync(prepared.codec)(JSON.parse(text))).toStrictEqual({
      answer: 'Hello'
    });
    expect(body?.output_config?.format?.type).toBe('json_schema');
    expect(JSON.stringify(body?.output_config?.format?.schema)).toContain('answer');
  }
);
