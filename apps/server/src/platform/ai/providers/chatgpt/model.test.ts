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

import { createServer } from 'node:http';

import { defaultAgentRules } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { titleAgent } from '#server/features/notes/agents/title';
import { generateAgent, layer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';

testStable('Responses adapter retries 401 with rotated OAuth token and consumes SSE', async () => {
  const bodies: Record<string, unknown>[] = [];
  const headers: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];

    for await (const chunk of req) chunks.push(chunk as Buffer);

    if (req.url === '/api/accounts/oauth/token') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          access_token: 'renewed',
          refresh_token: 'rotated',
          expires_in: 3600
        })
      );

      return;
    }

    headers.push(req.headers.authorization ?? '');
    bodies.push(JSON.parse(Buffer.concat(chunks).toString()));

    if (headers.length === 1) {
      res.writeHead(401).end();

      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' });

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
      res.write(`data: ${JSON.stringify(event)}\n\n`);

    res.end('data: [DONE]\n\n');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
