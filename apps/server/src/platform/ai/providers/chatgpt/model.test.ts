import { LlmModel, pageTransformOutputSchema } from '@study/contracts';
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
import { test } from '@study/testing';
import { Effect, Schema, Stream } from 'effect';
import { LanguageModel } from 'effect/ai';

import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';

import { makeChatGptCatalog } from './catalog.ts';

test.unit.stable(
  'Responses adapter sends the latest Sol release and retries 401 with a rotated token',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const bodies: Record<string, unknown>[] = [];
    const headers: string[] = [];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (req) => {
        let events = '';
        const requestBody = await req.text();

        if (new URL(req.url).pathname === '/models') {
          expect(req.method).toBe('GET');
          expect(req.headers.get('authorization')).toBe('Bearer original');

          return Response.json({
            models: [
              { slug: 'gpt-6.1-sol', visibility: 'list' },
              { slug: 'gpt-6.2-sol', visibility: 'list' }
            ]
          });
        }

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
            response: { id: 'resp', created_at: 1, model: 'gpt-6.2-sol' }
          },
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              id: 'item',
              role: 'assistant',
              content: [],
              status: 'in_progress'
            }
          },
          {
            type: 'response.output_text.delta',
            item_id: 'item',
            output_index: 0,
            content_index: 0,
            delta: 'Biology'
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp',
              created_at: 1,
              model: 'gpt-6.2-sol',
              output: [
                {
                  type: 'message',
                  id: 'item',
                  role: 'assistant',
                  status: 'completed',
                  content: [{ type: 'output_text', text: 'Biology', annotations: [] }]
                }
              ],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
            }
          }
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
      const catalog = await Effect.runPromise(makeChatGptCatalog(auth, undefined, base));
      const selection = await Effect.runPromise(catalog(LlmModel.SOL));
      const model = createChatGptModel({ ...selection, baseUrl: base });
      const result = await Effect.runPromise(
        LanguageModel.generateText({
          prompt: [
            { role: 'system', content: 'Write a study note title.' },
            { role: 'user', content: 'Cells' }
          ]
        }).pipe(Effect.provide(model))
      );

      assert.ok(result.text === 'Biology');
      expect(headers).toStrictEqual(['Bearer original', 'Bearer renewed']);
      expect(bodies.map((body) => body.model)).toEqual(['gpt-6.2-sol', 'gpt-6.2-sol']);
      assert.ok(bodies[1].stream === true);
      assert.ok(bodies[1].store === false);
      expect(String(bodies[1].instructions)).toMatch(/study note/i);
      assert.ok(Array.isArray(bodies[1].input));
    } finally {
      await auth.dispose();
      await server.stop(true);
    }
  }
);

test.unit.stable(
  'page generation transmits a closed strict schema through the Responses adapter',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;
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
            item: {
              type: 'message',
              id: 'item',
              role: 'assistant',
              content: [],
              status: 'in_progress'
            }
          },
          {
            type: 'response.output_text.delta',
            item_id: 'item',
            output_index: 0,
            content_index: 0,
            delta: JSON.stringify(output)
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp',
              created_at: 1,
              model: 'gpt-test',
              output: [
                {
                  type: 'message',
                  id: 'item',
                  role: 'assistant',
                  status: 'completed',
                  content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }]
                }
              ],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
            }
          }
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
      const prepared = model.withOutputSchema?.(pageTransformOutputSchema);

      assert.ok(prepared);

      const parts = await Effect.runPromise(
        LanguageModel.streamText({ prompt: 'Write a page.' }).pipe(
          Stream.runCollect,
          Effect.provide(prepared.model)
        )
      );
      const text = parts
        .flatMap((part) => (part.type === 'text-delta' ? [part.delta] : []))
        .join('');
      const result = Schema.decodeUnknownSync(prepared.codec)(JSON.parse(text));

      expect(result).toStrictEqual({
        ...output,
        blocks: [
          {
            type: 'paragraph',
            inlines: [{ type: 'link', text: 'Cells', href: 'https://example.com' }]
          }
        ]
      });
      expect(body?.text.format.type).toBe('json_schema');
      expect(body?.text.format.strict).toBe(true);
      let objects = 0;

      function inspect({ expect }: Pick<test.unit.Context, 'expect'>, value: unknown) {
        if (Array.isArray(value)) value.forEach((arg0) => inspect({ expect }, arg0));
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

          Object.values(value).forEach((arg0) => inspect({ expect }, arg0));
        }
      }

      inspect({ expect }, body?.text.format.schema);
      expect(objects).toBeGreaterThan(10);
    } finally {
      await auth.dispose();
      await server.stop(true);
    }
  }
);

test.unit.stable(
  'ChatGPT rejects missing, incomplete and failed terminal events without exposing provider details',
  async ({ expect }) => {
    const auth = new AuthManager({ issuer: 'http://127.0.0.1', saveRefresh: async () => {} });

    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'test' },
      { accessToken: 'secret-access-token', expiresIn: 3600 }
    );

    try {
      for (const terminal of [undefined, 'response.incomplete', 'response.failed', 'error']) {
        const response = {
          id: 'resp',
          created_at: 1,
          model: 'gpt-test',
          output: [],
          status: terminal === 'response.failed' ? 'failed' : 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 }
        };
        const events = [
          { type: 'response.created', response: { id: 'resp', created_at: 1, model: 'gpt-test' } }
        ];
        const wire: unknown[] = [...events];

        if (terminal)
          wire.push(
            terminal === 'error'
              ? { type: 'error', code: 'failed', message: 'private-provider-detail', param: null }
              : { type: terminal, response }
          );

        const model = createChatGptModel({
          auth,
          modelId: 'gpt-test',
          fetch: async () =>
            new Response(wire.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
              headers: { 'content-type': 'text/event-stream' }
            })
        });
        const reported: (number | undefined)[] = [];
        const result = await Effect.runPromiseExit(
          LanguageModel.streamText({ prompt: 'Hello' }).pipe(
            Stream.tap((part) =>
              Effect.sync(() => {
                if (part.type === 'finish') reported.push(part.usage.inputTokens.total);
              })
            ),
            Stream.runCollect,
            Effect.provide(model)
          )
        );

        expect(result._tag).toBe('Failure');
        expect(reported).toStrictEqual(
          terminal === 'response.incomplete' || terminal === 'response.failed' ? [7] : []
        );
        expect(String(result)).not.toContain('private-provider-detail');
        expect(String(result)).not.toContain('secret-access-token');
      }
    } finally {
      await auth.dispose();
    }
  }
);
