/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks provider registration, public metadata and SDK model construction without   │
 * │ live credentials.                                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises all registered providers and rejects unknown provider identifiers.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use production provider factories; no external provider calls are required here.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createServer } from 'node:http';

import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { jsonSchema, Output, streamText } from 'ai';
import { expect } from 'vite-plus/test';

import { webSearchTool } from '#server/platform/ai/web-search-tool';

import { createApiKeyModel } from './api-key-model.ts';
import { apiKeyProviders, getApiKeyProvider } from './registry.ts';
import { adaptProviderTool } from './tools.ts';

testStable(
  'compatible providers stream schema-validated JSON without requiring strict JSON Schema',
  async () => {
    let body: { response_format?: unknown; messages: unknown[]; tools: unknown[] } | undefined;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];

      for await (const chunk of req) chunks.push(Buffer.from(chunk));

      body = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const base = { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test-model' };

      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '{"answer":"Hello"}' }, finish_reason: null }] })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`
      );
      res.end('data: [DONE]\n\n');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    expect(address).not.toBeNull();
    const base = `http://127.0.0.1:${(address as { port: number }).port}`;
    const schema = jsonSchema<{ answer: string }>({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false
    });

    try {
      for (const provider of apiKeyProviders.filter(
        (entry) => !['anthropic', 'google'].includes(entry.id)
      )) {
        const model = provider.createModel({
          apiKey: 'test-secret',
          modelId: 'test-model',
          fetch: (_url, init) => fetch(base, init)
        });
        const result = streamText({
          model,
          prompt: 'Answer in JSON.',
          output: Output.object({ schema }),
          tools: {
            sources: {
              description: 'Read captured sources',
              inputSchema: jsonSchema({ type: 'object', properties: {} })
            }
          }
        });

        expect(await result.output).toStrictEqual({ answer: 'Hello' });
        expect(body?.response_format).toStrictEqual({ type: 'json_object' });
        expect(JSON.stringify(body?.messages)).toContain('JSON Schema');
        expect(JSON.stringify(body?.messages)).toContain('answer');
        expect(body?.tools).toHaveLength(1);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }
);

testStable('Gemini 2 keeps function tools without mixing incompatible grounding tools', () => {
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
});

testStable(
  'queued models resolve replacement keys on each call and reject removed keys before transport',
  async () => {
    let key: string | undefined = 'first-key';
    const seen: string[] = [];
    const model = createApiKeyModel(
      getApiKeyProvider('deepseek'),
      'deepseek-flash',
      async () => {
        if (!key) throw new StudyError('auth', 'Key removed');

        return key;
      },
      async (_url, init) => {
        seen.push(new Headers(init?.headers).get('authorization') ?? '');

        throw new StudyError('transient', 'Test transport');
      }
    );

    key = 'replacement-key';
    await expect(model.doGenerate({ prompt: [] })).rejects.toMatchObject({ kind: 'transient' });
    expect(seen).toStrictEqual(['Bearer replacement-key']);
    key = undefined;
    await expect(model.doStream({ prompt: [] })).rejects.toThrow('Key removed');
    expect(seen).toHaveLength(1);
  }
);

testStable('API-key models use bounded HTTP bodies and reject redirects', async () => {
  let redirect: RequestRedirect | undefined;
  const model = createApiKeyModel(
    getApiKeyProvider('deepseek'),
    'deepseek-flash',
    async () => 'test-key',
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

  await expect(model.doGenerate({ prompt: [] })).rejects.toMatchObject({ kind: 'transient' });
  expect(redirect).toBe('error');
});
