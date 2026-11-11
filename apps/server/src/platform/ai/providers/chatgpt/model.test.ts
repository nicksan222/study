/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises the ChatGPT Responses model adapter against a local HTTP peer. It checks │
 * │ OAuth token rotation after authorization failure and consumption of the streamed         │
 * │ response.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: Responses adapter retries 401 with rotated OAuth token and consumes SSE.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Starts #server/features/notes/agents/title, #server/platform/ai/agents,                  │
 * │ #server/platform/ai/providers/chatgpt/model against a local HTTP peer; the test owns and │
 * │ closes that peer.                                                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { pageTransformOutputSchema } from '@study/contracts/ai/page-transform';
import { defaultAgentRules } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { Output, streamText } from 'ai';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { titleAgent } from '#server/features/notes/agents/title';
import { generateAgent, layer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { standardSchema } from '#server/platform/ai/schema';

testStable('Responses adapter retries 401 with rotated OAuth token and consumes SSE', async () => {
  const bodies: Record<string, unknown>[] = [];
  const headers: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (req) => {
      let events = '';
      const requestBody = await req.text();

      if (new URL(req.url).pathname === '/api/accounts/oauth/token') {
        return new Response(
          JSON.stringify({
            access_token: 'renewed',
            refresh_token: 'rotated',
            expires_in: 3600
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      }

      headers.push(req.headers.get('authorization') ?? '');
      bodies.push(JSON.parse(requestBody));

      if (headers.length === 1) {
        return new Response(null, { status: 401 });
      }

      for (const event of [
        {
          type: 'response.created',
          response: { id: 'resp', created_at: 1, model: 'gpt-test' }
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'item' }
        },
        { type: 'response.output_text.delta', item_id: 'item', delta: 'Biology' },
        { type: 'response.completed', response: {} }
      ])
        events += `data: ${JSON.stringify(event)}\n\n`;

      return new Response(events + 'data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      });
    }
  });
  const address = { port: server.port };

  if (!address || typeof address === 'string') throw Error('missing address');

  const base = `http://127.0.0.1:${address.port}`;
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'first' },
      { accessToken: 'original', expiresIn: 3600 }
    );
    const model = createChatGptModel({
      auth,
      modelId: 'gpt-test',
      baseUrl: base
    });
    const result = await Effect.runPromise(
      generateAgent(titleAgent, { prompt: 'Cells' }).pipe(
        Effect.provide(
          layer({
            model: () => Effect.succeed(model),
            language: 'en',
            rules: Effect.succeed(defaultAgentRules),
            searchSources: () => Effect.succeed([])
          })
        )
      )
    );

    assert.ok(result === 'Biology');
    expect(headers).toStrictEqual(['Bearer original', 'Bearer renewed']);
    assert.ok(bodies[1].stream === true);
    assert.ok(bodies[1].store === false);
    expect(String(bodies[1].instructions)).toMatch(/study note/i);
    assert.ok(Array.isArray(bodies[1].input));
  } finally {
    await auth.dispose();
    await server.stop(true);
  }
});

testStable(
  'page generation transmits a closed strict schema through the Responses adapter',
  async () => {
    let body: { text: { format: { type: string; strict: boolean; schema: unknown } } } | undefined;
    const output = {
      blocks: [
        {
          type: 'paragraph',
          inlines: [{ type: 'link', text: 'Cells', href: 'https://example.com', marks: null }]
        }
      ],
      notes: [{ kind: 'limit', explanation: 'Captured material only', blockOrdinals: [] }]
    };
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (req) => {
        let events = '';
        const requestBody = await req.text();

        body = JSON.parse(requestBody);

        for (const event of [
          { type: 'response.created', response: { id: 'resp', created_at: 1, model: 'gpt-test' } },
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'item' }
          },
          { type: 'response.output_text.delta', item_id: 'item', delta: JSON.stringify(output) },
          { type: 'response.completed', response: {} }
        ])
          events += `data: ${JSON.stringify(event)}\n\n`;

        return new Response(events + 'data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' }
        });
      }
    });
    const address = { port: server.port };

    if (!address || typeof address === 'string') throw Error('missing address');

    const auth = new AuthManager({
      issuer: `http://127.0.0.1:${address.port}`,
      saveRefresh: async () => {}
    });

    try {
      await auth.replace(
        { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'test' },
        { accessToken: 'test', expiresIn: 3600 }
      );
      const model = createChatGptModel({
        auth,
        modelId: 'gpt-test',
        baseUrl: `http://127.0.0.1:${address.port}`
      });
      const result = streamText({
        model,
        prompt: 'Write a page.',
        output: Output.object({ schema: standardSchema(pageTransformOutputSchema) })
      });

      expect(await result.output).toStrictEqual(output);
      expect(body?.text.format.type).toBe('json_schema');
      expect(body?.text.format.strict).toBe(true);
      let objects = 0;

      function inspect(value: unknown) {
        if (Array.isArray(value)) value.forEach(inspect);
        else if (value !== null && typeof value === 'object') {
          if (
            'properties' in value &&
            value.properties !== null &&
            typeof value.properties === 'object'
          ) {
            objects++;
            expect(value).toMatchObject({
              additionalProperties: false,
              required: Object.keys(value.properties)
            });
          }

          Object.values(value).forEach(inspect);
        }
      }

      inspect(body?.text.format.schema);
      expect(objects).toBeGreaterThan(10);
    } finally {
      await auth.dispose();
      await server.stop(true);
    }
  }
);
