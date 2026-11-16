import { sourcesOutputSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks native Effect structured generation with a grounded source tool against a   │
 * │ local Responses API peer. The native model covers the initial tool-call exchange without  │
 * │ representing production traffic.                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: native structured generation stops after a grounded tool call.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Starts #server/features/materials/agents/flashcards, #server/platform/ai/evidence,       │
 * │ #server/platform/ai/providers/chatgpt/model against a local HTTP peer; the test owns and │
 * │ closes that peer.                                                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';
import { LanguageModel, Tool, Toolkit } from 'effect/ai';

import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';

test.unit.stable(
  'native structured generation stops after a grounded tool call',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    let requests = 0;
    let body = '';
    let output: string | undefined;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (req) => {
        let events = '';
        const requestBody = await req.text();

        body = requestBody;
        requests++;

        if (output !== undefined) {
          for (const event of [
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: {
                type: 'message',
                id: 'm',
                role: 'assistant',
                status: 'in_progress',
                content: []
              }
            },
            {
              type: 'response.output_text.delta',
              item_id: 'm',
              output_index: 0,
              content_index: 0,
              delta: output
            },
            {
              type: 'response.completed',
              response: {
                id: 'resp',
                created_at: 1,
                model: 'test',
                output: [
                  {
                    type: 'message',
                    id: 'm',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text: output, annotations: [] }]
                  }
                ],
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
              }
            }
          ])
            events += `data: ${JSON.stringify(event)}\n\n`;

          return new globalThis.Response(events, {
            headers: { 'content-type': 'text/event-stream' }
          });
        }

        const call = {
          type: 'function_call',
          id: 'item1',
          call_id: 'call1',
          name: 'sources',
          arguments: '{"query":"cell"}'
        };

        for (const event of [
          { type: 'response.output_item.added', output_index: 0, item: call },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: { ...call, status: 'completed' }
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp',
              created_at: 1,
              model: 'test',
              output: [{ ...call, status: 'completed' }],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
            }
          }
        ])
          events += `data: ${JSON.stringify(event)}\n\n`;

        return new globalThis.Response(events, {
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
        { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
        { accessToken: 'a', expiresIn: 3600 }
      );
      const provider = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
      const catalog = createEvidenceCatalog([
        { key: 'doc', reference: 'doc', name: 'Notes', blocks: [{ text: 'A cell uses energy.' }] }
      ]);
      const source = Tool.make('sources', {
        description: flashcardsAgent.tools.sources.description,
        parameters: flashcardsAgent.tools.sources.input,
        success: sourcesOutputSchema
      });
      const toolkit = Toolkit.make(source);
      const program = LanguageModel.generateObject({
        prompt: flashcardsAgent.prompt({ prompt: 'Make a card about cells' }),
        schema: flashcardsAgent.output,
        toolkit
      });
      const result = await Effect.runPromise(
        Effect.flip(program).pipe(
          Effect.provide(provider),
          Effect.provide(
            toolkit.toLayer({
              sources: (input) =>
                flashcardsAgent.tools.sources
                  .execute(input, {
                    language: 'en',
                    searchSources: (query) => Effect.succeed(catalog.search(query))
                  })
                  .pipe(Effect.orDie, Effect.map(Schema.decodeUnknownSync(sourcesOutputSchema)))
            })
          )
        )
      );

      assert.ok(result.reason._tag === 'StructuredOutputError');
      assert.strictEqual(requests, 1);
      assert.ok(catalog.citations('answer [1]')[0]?.quote === 'A cell uses energy.');
      expect(body).toMatch(/Make a card about cells/);
      expect(body).toMatch(/sources/);
      output = JSON.stringify({
        kind: 'flashcards',
        cards: [{ front: 'What uses energy?', back: 'A cell [1]' }]
      });
      const decoded = await Effect.runPromise(
        LanguageModel.generateObject({
          prompt: 'Make a card',
          schema: flashcardsAgent.output
        }).pipe(Effect.provide(provider))
      );

      assert.ok(decoded.value.cards[0]?.back === 'A cell [1]');
      assert.ok(catalog.citations(decoded.value.cards[0]?.back ?? '')[0]?.reference === 'doc');
      output = JSON.stringify({ kind: 'flashcards', cards: [] });
      const invalid = await Effect.runPromise(
        Effect.flip(
          LanguageModel.generateObject({
            prompt: 'Make a card',
            schema: flashcardsAgent.output
          }).pipe(Effect.provide(provider))
        )
      );

      assert.ok(invalid.reason._tag === 'StructuredOutputError');
    } finally {
      await auth.dispose();
      await server.stop(true);
    }
  }
);
