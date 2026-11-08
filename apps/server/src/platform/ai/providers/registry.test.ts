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
import { expect, expectTypeOf } from 'vite-plus/test';

import { anthropic } from './anthropic.ts';
import { apiKeyProviders, getApiKeyProvider, providerCatalog } from './registry.ts';

testStable('the provider registry exposes ten API-key providers without credentials', () => {
  expect(apiKeyProviders).toHaveLength(10);
  expect(new Set(apiKeyProviders.map((provider) => provider.id)).size).toBe(10);
  expect(providerCatalog().map((provider) => provider.id)).toContain('anthropic');
  expect(providerCatalog().map((provider) => provider.id)).toContain('openrouter');
  expect(providerCatalog().map((provider) => provider.id)).toContain('deepseek');
  expect(JSON.stringify(providerCatalog())).not.toContain('apiKey');
});

testStable('unknown providers fail before a request can be constructed', () => {
  expect(() => getApiKeyProvider('unknown')).toThrow(StudyError);
});

testStable('each registry entry constructs an AI SDK v3 model with the requested id', () => {
  for (const provider of apiKeyProviders) {
    const model = provider.createModel({ apiKey: 'test-key', modelId: 'test-model' });

    expect(model.specificationVersion).toBe('v3');
    expect(model.modelId).toBe('test-model');
  }
});

testStable(
  'all providers serialize credentials and parse their native protocol over HTTP',
  async () => {
    const expectedOrigins: Record<string, string> = {
      anthropic: 'https://api.anthropic.com',
      google: 'https://generativelanguage.googleapis.com',
      openrouter: 'https://openrouter.ai',
      deepseek: 'https://api.deepseek.com',
      mistral: 'https://api.mistral.ai',
      groq: 'https://api.groq.com',
      xai: 'https://api.x.ai',
      together: 'https://api.together.xyz',
      fireworks: 'https://api.fireworks.ai',
      cerebras: 'https://api.cerebras.ai'
    };
    let selected = '';
    let authorization: string | undefined;
    let requestedModel: string | undefined;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];

      for await (const chunk of req) chunks.push(Buffer.from(chunk));

      const body = JSON.parse(Buffer.concat(chunks).toString());

      requestedModel = body.model;
      authorization = String(
        req.headers['x-api-key'] ?? req.headers['x-goog-api-key'] ?? req.headers.authorization
      );
      const response =
        selected === 'anthropic'
          ? {
              id: 'test',
              type: 'message',
              role: 'assistant',
              model: 'test-model',
              content: [{ type: 'text', text: 'Hello' }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 }
            }
          : selected === 'google'
            ? {
                candidates: [
                  { content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }
                ],
                usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
              }
            : {
                id: 'test',
                object: 'chat.completion',
                created: 1,
                model: 'test-model',
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: 'Hello' },
                    finish_reason: 'stop'
                  }
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
              };

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    expect(address).not.toBeNull();
    expect(typeof address).toBe('object');

    const base = `http://127.0.0.1:${(address as { port: number }).port}`;

    try {
      for (const provider of apiKeyProviders) {
        selected = provider.id;
        let target: URL | undefined;
        const model = provider.createModel({
          apiKey: 'test-secret',
          modelId: 'test-model',
          fetch: (input, init) => {
            target = new URL(input instanceof Request ? input.url : String(input));

            return fetch(new URL(target.pathname + target.search, base), init);
          }
        });
        const result = await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]
        });

        expect(result.content).toContainEqual({ type: 'text', text: 'Hello' });
        expect(target?.origin).toBe(expectedOrigins[provider.id]);
        expect(authorization).toBe(
          provider.id === 'anthropic' || provider.id === 'google'
            ? 'test-secret'
            : 'Bearer test-secret'
        );

        if (provider.id !== 'google') expect(requestedModel).toBe('test-model');

        expect(result.finishReason.unified).toBe('stop');
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }
);

testStable(
  'provider model options retain literal types and every tier default is selectable',
  () => {
    expectTypeOf(anthropic.models).toEqualTypeOf<
      readonly ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']
    >();

    for (const provider of apiKeyProviders) {
      const models: readonly string[] = provider.models;

      for (const model of Object.values(provider.defaults)) expect(models).toContain(model);
    }
  }
);
