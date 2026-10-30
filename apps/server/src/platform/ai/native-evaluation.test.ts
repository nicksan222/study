import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { sourcesOutputSchema } from '@study/contracts/ai/sources';
import { Effect, Schema, Stream } from 'effect';
import type { Response } from 'effect/ai';
import { AiError, LanguageModel, Tool, Toolkit } from 'effect/ai';

import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';

// This deliberately narrow, test-only bridge handles the single initial prompt
// needed to measure Effect's object-with-tools behavior, not production traffic.
test('native structured generation stops after a grounded tool call', async () => {
  let requests = 0;
  let body = '';
  let output: string | undefined;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];

    for await (const chunk of req) chunks.push(chunk as Buffer);

    body = Buffer.concat(chunks).toString();
    requests++;

    if (output !== undefined) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });

      for (const event of [
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } },
        { type: 'response.output_text.delta', item_id: 'm', delta: output },
        { type: 'response.completed', response: {} }
      ])
        res.write(`data: ${JSON.stringify(event)}\n\n`);

      res.end();

      return;
    }

    const call = {
      type: 'function_call',
      id: 'item1',
      call_id: 'call1',
      name: 'sources',
      arguments: '{"query":"cell"}'
    };

    res.writeHead(200, { 'content-type': 'text/event-stream' });

    for (const event of [
      { type: 'response.output_item.added', output_index: 0, item: call },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { ...call, status: 'completed' }
      },
      { type: 'response.completed', response: {} }
    ])
      res.write(`data: ${JSON.stringify(event)}\n\n`);

    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

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
    const native = await Effect.runPromise(
      LanguageModel.make({
        generateText: (options) =>
          Effect.tryPromise({
            try: async (signal) => {
              const result = await provider.doGenerate({
                abortSignal: signal,
                prompt: [
                  { role: 'system', content: flashcardsAgent.instructions('en') },
                  { role: 'user', content: [{ type: 'text', text: 'Make a card about cells' }] }
                ],
                tools: options.tools.map((tool) => ({
                  type: 'function' as const,
                  name: tool.name,
                  description: tool.description,
                  inputSchema: Tool.getJsonSchema(tool)
                })),
                responseFormat: {
                  type: 'json',
                  schema: Tool.getJsonSchemaFromSchema(flashcardsAgent.output),
                  name: 'flashcards'
                }
              });

              return result.content.flatMap((part): Response.PartEncoded[] => {
                if (part.type === 'text') return [{ type: 'text' as const, text: part.text }];

                if (part.type === 'tool-call')
                  return [
                    {
                      type: 'tool-call' as const,
                      id: part.toolCallId,
                      name: part.toolName,
                      params: JSON.parse(part.input)
                    }
                  ];

                return [];
              });
            },
            catch: () =>
              AiError.make({
                module: 'evaluation',
                method: 'generateText',
                reason: new AiError.UnknownError({ description: 'provider failed' })
              })
          }),
        streamText: () => Stream.empty
      })
    );
    const program = native.generateObject({
      prompt: flashcardsAgent.prompt({ prompt: 'Make a card about cells' }),
      schema: flashcardsAgent.output,
      toolkit
    });
    const result = await Effect.runPromise(
      Effect.flip(program).pipe(
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

    assert.equal(result.reason._tag, 'StructuredOutputError');
    assert.equal(requests, 1);
    assert.equal(catalog.citations('answer [1]')[0]?.quote, 'A cell uses energy.');
    assert.match(body, /Make a card about cells/);
    assert.match(body, /sources/);
    output = JSON.stringify({
      kind: 'flashcards',
      cards: [{ front: 'What uses energy?', back: 'A cell [1]' }]
    });
    const decoded = await Effect.runPromise(
      native.generateObject({ prompt: 'Make a card', schema: flashcardsAgent.output })
    );

    assert.equal(decoded.value.cards[0]?.back, 'A cell [1]');
    assert.equal(catalog.citations(decoded.value.cards[0]?.back ?? '')[0]?.reference, 'doc');
    output = JSON.stringify({ kind: 'flashcards', cards: [] });
    const invalid = await Effect.runPromise(
      Effect.flip(native.generateObject({ prompt: 'Make a card', schema: flashcardsAgent.output }))
    );

    assert.equal(invalid.reason._tag, 'StructuredOutputError');
  } finally {
    await auth.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
