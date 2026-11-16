import {
  agentRunIdSchema,
  failureSchema,
  AgentRule,
  StudyError,
  defaultAgentRules,
  titledFlashcardsGenerationOutputSchema
} from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises validated agent generation and streaming against a local Responses API   │
 * │ peer. Coverage includes structured output, tool calls, provider failures, and            │
 * │ cancellation behavior.                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: generates validated output through the Responses provider; rejects malformed  │
 * │   structured output.                                                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Starts #server/platform/ai/agents, #server/platform/ai/providers/chatgpt/model,          │
 * │ #server/platform/ai/providers/chatgpt/session against a local HTTP peer; the test owns   │
 * │ and closes that peer.                                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { workflow_agent_progress } from '@study/db';
import { test } from '@study/testing';
import { Effect, Fiber, Schema, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Workflow, WorkflowEngine } from 'effect/workflow';

import { makeAdmission } from '#server/platform/ai/admission';
import { Agents, generateAgent, layer, streamAgent } from '#server/platform/ai/agents';
import type { AgentProgress, AgentsConfig } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { deepseek } from '#server/platform/ai/providers/deepseek';
import { ProcedureTraceScope } from '#server/platform/ai/trace';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { defineAgent, defineTool } from '#server/platform/definitions/define-agent';
import {
  defineProcedure,
  procedureTool,
  runProcedure
} from '#server/platform/definitions/define-procedure';
import { normalizeError } from '#server/platform/errors/classify-error';
import { observeAgentProgress } from '#server/platform/workflows/agent-progress';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { admitTestExecution } from '#testing/workflow-admission';

const definition = defineAgent({
  id: 'reply',
  customRules: [AgentRule.Replies],
  input: Schema.String,
  output: Schema.String,
  model: 'tiny',
  instructions: 'Reply',
  prompt: (input) => input
});

const objectDefinition = defineAgent({
  id: 'object',
  customRules: [AgentRule.Replies],
  input: Schema.String,
  output: Schema.Struct({ count: Schema.Number }),
  model: 'tiny',
  instructions: 'Count',
  prompt: (input) => input,
  mode: 'object'
});

/** Supply the required Responses wire envelope while cases focus on the event under test. */
function eventJson(value: unknown): string {
  const event = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(value);

  if (event.type === 'response.output_text.delta')
    return JSON.stringify({ output_index: 0, content_index: 0, ...event });

  if (event.response && typeof event.response === 'object')
    return JSON.stringify({
      ...event,
      response: { id: 'response', model: 'test', created_at: 1, output: [], ...event.response }
    });

  if (
    event.item &&
    typeof event.item === 'object' &&
    'type' in event.item &&
    event.item.type === 'message'
  )
    return JSON.stringify({
      ...event,
      item: { role: 'assistant', content: [], status: 'completed', ...event.item }
    });

  return JSON.stringify(event);
}

function eventsResponse(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${eventJson(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  });
}

function send(text: string, finish = true): Response {
  return eventsResponse([
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } },
    { type: 'response.output_text.delta', item_id: 'm', delta: text },
    ...(finish ? [{ type: 'response.completed', response: {} }] : [])
  ]);
}

async function peer(
  { assert: assertions }: Pick<test.server.Context, 'assert'>,
  handler: (req: Request, body: string) => Response | Promise<Response>,
  run: (base: string, auth: AuthManager) => Promise<void>
) {
  const assert: test.Assert = assertions;

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (req) => handler(req, await req.text())
  });

  assert.ok(server.port, 'missing address');
  const base = server.url.origin;
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

  try {
    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'a', expiresIn: 3600 }
    );
    await run(base, auth);
  } finally {
    await auth.dispose();
    await server.stop(true);
  }
}

function service(
  base: string,
  auth: AuthManager,
  observe?: AgentsConfig['observe'],
  recordUsage?: AgentsConfig['recordUsage']
) {
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });

  return layer({
    observe,
    recordUsage,
    model: () => Effect.succeed(model),
    language: 'en',
    rules: Effect.succeed(defaultAgentRules),
    searchSources: () => Effect.succeed([])
  });
}

function mockService(mock: ReturnType<test.server.Context['createAiMock']>) {
  return layer({
    model: (tier, call) => mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError)),
    language: 'en',
    rules: Effect.succeed(defaultAgentRules),
    searchSources: () => Effect.succeed([])
  });
}

test.server.stable(
  'generates validated output through the Responses provider',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const observe: NonNullable<AgentsConfig['observe']> = (observation) =>
      Effect.sync(() => {
        expect(observation.phase).toBe('generating');
        expect(observation.trace).toMatchObject({
          kind: 'agent',
          purpose: 'agent',
          parentRunId: 'parent',
          parentToolCallId: 'call',
          attempt: 1,
          startedAtMs: expect.any(BigInt),
          input: { text: '"cells"', truncated: false }
        });

        if (observation.event.type === 'complete')
          expect(observation.event.output).toEqual({ text: '"Biology"', truncated: false });
      });

    await peer(
      { assert },
      (_req) => send('Biology'),
      async (base, auth) => {
        assert.ok(
          (await Effect.runPromise(
            generateAgent(definition, 'cells').pipe(
              Effect.provideService(ProcedureTraceScope, {
                parentRunId: agentRunIdSchema.make('parent'),
                parentToolCallId: 'call',
                depth: 1,
                path: '/parent'
              }),
              Effect.provide(service(base, auth, observe))
            )
          )) === 'Biology'
        );
      }
    );
  }
);

test.server.stable(
  'the harness publishes partial output before generation completes',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let finish!: () => void;
    let sawDelta!: () => void;
    const partial = new Promise<void>((resolve) => {
      sawDelta = resolve;
    });
    const observed: string[] = [];
    const observe: NonNullable<AgentsConfig['observe']> = (observation) =>
      Effect.sync(() => {
        observed.push(observation.event.type);

        if (observation.event.type === 'text-delta') sawDelta();
      });

    await peer(
      { assert },
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();

              controller.enqueue(
                encoder.encode(
                  `data: ${eventJson({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } })}\n\n`
                )
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${eventJson({ type: 'response.output_text.delta', item_id: 'm', delta: 'First' })}\n\n`
                )
              );
              finish = () => {
                controller.enqueue(
                  encoder.encode(
                    `data: ${eventJson({ type: 'response.completed', response: {} })}\n\n`
                  )
                );
                controller.close();
              };
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        ),
      async (base, auth) => {
        let complete = false;
        const running = Effect.runPromise(
          generateAgent(definition, 'x').pipe(Effect.provide(service(base, auth, observe)))
        ).then((text) => {
          complete = true;

          return text;
        });

        try {
          await partial;
          expect(complete).toBe(false);
          expect(observed).toStrictEqual(['start', 'text-delta']);
        } finally {
          finish();
        }

        expect(await running).toBe('First');
        expect(observed).toStrictEqual(['start', 'text-delta', 'complete']);
      }
    );
  }
);

test.server.stable(
  'rejects malformed structured output',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    await peer(
      { assert },
      (_req) => send('{"count":"wrong"}'),
      async (base, auth) => {
        await expect(
          Effect.runPromise(
            generateAgent(objectDefinition, 'x').pipe(Effect.provide(service(base, auth)))
          )
        ).rejects.toThrow();
      }
    );
  }
);

test.server.stable(
  'batches preview writes without delaying direct deltas or losing the final text',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let response!: ReadableStreamDefaultController<Uint8Array>;
    let sawFirst!: () => void;
    let sawDirectBurst!: () => void;
    const first = new Promise<void>((resolve) => {
      sawFirst = resolve;
    });
    const directBurst = new Promise<void>((resolve) => {
      sawDirectBurst = resolve;
    });
    const previews: string[] = [];
    const direct: string[] = [];
    const expected = `First${'x'.repeat(50)}`;
    const delta = (text: string) =>
      response.enqueue(
        new TextEncoder().encode(
          `data: ${eventJson({ type: 'response.output_text.delta', item_id: 'm', delta: text })}\n\n`
        )
      );
    const receive = (event: AgentProgress<string>) =>
      Effect.sync(() => {
        if (event.type !== 'text-delta') return;

        direct.push(event.text);

        if (direct.join('') === expected) sawDirectBurst();
      });
    const observe: NonNullable<AgentsConfig['observe']> = (observation) =>
      Effect.sync(() => {
        if (observation.event.type !== 'text-delta') return;

        previews.push(observation.event.text);

        if (previews.join('') === 'First') sawFirst();
      });
    const verify = Effect.gen(function* () {
      const running = yield* streamAgent(definition, 'x').pipe(
        Stream.tap(receive),
        Stream.runLast,
        Effect.forkChild
      );

      try {
        yield* Effect.promise(() => first);

        for (let i = 0; i < 50; i++) delta('x');

        // Synchronize with real SSE delivery before advancing the preview clock.
        yield* Effect.promise(() => directBurst);
        expect(previews).toEqual(['First']);
        expect(direct).toHaveLength(51);

        yield* TestClock.adjust('100 millis');
        expect(previews).toEqual(['First', 'x'.repeat(50)]);
      } finally {
        delta('tail');
        response.enqueue(
          new TextEncoder().encode(
            `data: ${eventJson({ type: 'response.completed', response: {} })}\n\n`
          )
        );
        response.close();
        yield* Fiber.join(running);
      }

      expect(previews.join('')).toBe(`${expected}tail`);
    });

    await peer(
      { assert },
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              response = controller;
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${eventJson({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } })}\n\n`
                )
              );
              delta('First');
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        ),
      (base, auth) =>
        Effect.runPromise(
          verify.pipe(
            Effect.provide(service(base, auth, observe)),
            Effect.provide(TestClock.layer())
          )
        )
    );
  }
);

for (const intercepted of [false, true])
  test.server.stable(
    `executes a validated source tool with runtime adapter ${intercepted}`,
    async ({ createAiMock, assert: assertions, expect }) => {
      const assert: test.Assert = assertions;

      using mock = createAiMock();
      const bodies: string[] = [];

      await peer(
        { assert },
        (_req, body) => {
          bodies.push(body);

          if (bodies.length !== 1) return send('Cells use energy.');

          const call = {
            type: 'function_call',
            id: 'item1',
            call_id: 'call1',
            name: 'sources',
            arguments: '{"query":"cell"}'
          };

          let events = '';

          for (const event of [
            { type: 'response.output_item.added', output_index: 0, item: call },
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: { ...call, status: 'completed' }
            },
            { type: 'response.completed', response: {} }
          ])
            events += `data: ${eventJson(event)}\n\n`;

          return new Response(events, { headers: { 'content-type': 'text/event-stream' } });
        },
        async (base, auth) => {
          const queries: string[] = [];
          const observed: string[] = [];
          const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
          const withTool = defineAgent({
            ...definition,
            tools: {
              sources: defineTool({
                description: 'Find sources',
                wiki: {
                  when: 'Find evidence.',
                  examples: ['Find cells.'],
                  limits: 'Captured sources only.'
                },
                output: Schema.Array(
                  Schema.Struct({ id: Schema.String, name: Schema.String, text: Schema.String })
                ),
                mutates: false,
                input: Schema.Struct({ query: Schema.String }),
                execute: (input, environment) =>
                  environment.searchSources(
                    Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }))(input).query
                  )
              })
            }
          });

          if (intercepted)
            mock.next(withTool.tools.sources, {
              input: { query: 'cell' },
              output: [{ id: '1', name: 'notes', text: 'Cells use energy' }]
            });

          const executeTool: AgentsConfig['executeTool'] = intercepted
            ? (call, execute) =>
                mock.runtime.executeTool(call, execute).pipe(Effect.mapError(normalizeError))
            : undefined;
          const output = await Effect.runPromise(
            generateAgent(withTool, 'x').pipe(
              Effect.provide(
                layer({
                  observe: (observation) =>
                    Effect.sync(() => {
                      observed.push(observation.event.type);
                    }),
                  model: () => Effect.succeed(model),
                  executeTool,
                  language: 'en',
                  rules: Effect.succeed(defaultAgentRules),
                  searchSources: (query) => {
                    queries.push(query);

                    return Effect.succeed([{ id: '1', name: 'notes', text: 'Cells use energy' }]);
                  }
                })
              )
            )
          );

          assert.ok(output === 'Cells use energy.');
          expect(queries).toStrictEqual(intercepted ? [] : ['cell']);
          expect(bodies[1]).toMatch(/Cells use energy/);
          expect(observed).toStrictEqual([
            'start',
            'tool-start',
            'tool-finish',
            'text-delta',
            'complete'
          ]);
        }
      );
    }
  );

test.server.stable(
  'streams text before the provider completes and never completes a truncated response',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const { Stream } = await import('effect');
    const { streamAgent } = await import('#server/platform/ai/agents');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();

              for (const event of [
                {
                  type: 'response.output_item.added',
                  output_index: 0,
                  item: { type: 'message', id: 'm' }
                },
                { type: 'response.output_text.delta', item_id: 'm', delta: 'partial' }
              ])
                controller.enqueue(encoder.encode(`data: ${eventJson(event)}\n\n`));

              await gate;
              controller.close();
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        );
      }
    });

    assert.ok(server.port, 'missing address');
    const base = server.url.origin;
    const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

    try {
      await auth.replace(
        { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
        { accessToken: 'a', expiresIn: 3600 }
      );
      const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
      const definition = defineAgent({
        id: 'reply',
        customRules: [AgentRule.Replies],
        input: Schema.String,
        output: Schema.String,
        model: 'tiny',
        instructions: 'Reply',
        prompt: (input) => input
      });
      const seen: unknown[] = [];
      let received!: () => void;
      const first = new Promise<void>((resolve) => {
        received = resolve;
      });
      const running = Effect.runPromise(
        streamAgent(definition, 'x').pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              seen.push(event);
              received();
            })
          ),
          Stream.runDrain,
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
      const rejected = (async () => {
        await expect(running).rejects.toThrow();
      })();

      try {
        await Promise.race([
          first,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(Error('delta was buffered')), 500)
          )
        ]);
        expect(seen).toStrictEqual([{ type: 'text-delta', text: 'partial' }]);
      } finally {
        release();
      }

      await rejected;
      expect(seen).toStrictEqual([{ type: 'text-delta', text: 'partial' }]);
    } finally {
      release();
      await auth.dispose();
      await server.stop(true);
    }
  }
);

test.server.stable(
  'retries rate-limited requests up to the configured limit',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    let calls = 0;

    await peer(
      { assert },
      (_req) => {
        calls++;

        return calls === 1 ? new Response(null, { status: 429 }) : send('ok');
      },
      async (base, auth) => {
        assert.ok(
          (await Effect.runPromise(
            generateAgent(definition, 'x', { maxRetries: 1 }).pipe(
              Effect.provide(service(base, auth))
            )
          )) === 'ok'
        );
        assert.strictEqual(calls, 2);
      }
    );
  }
);

test.server.stable(
  'cancellation after a delta never publishes completion',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: unknown[] = [];

    try {
      await peer(
        { assert },
        () =>
          new Response(
            new ReadableStream({
              async start(controller) {
                const encoder = new TextEncoder();

                for (const event of [
                  {
                    type: 'response.output_item.added',
                    output_index: 0,
                    item: { type: 'message', id: 'm' }
                  },
                  { type: 'response.output_text.delta', item_id: 'm', delta: 'partial' }
                ])
                  controller.enqueue(encoder.encode(`data: ${eventJson(event)}\n\n`));

                await gate;

                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${eventJson({ type: 'response.completed', response: {} })}\n\n`
                    )
                  );
                  controller.close();
                } catch {
                  /* cancelled by client */
                }
              }
            }),
            { headers: { 'content-type': 'text/event-stream' } }
          ),
        async (base, auth) => {
          const controller = new AbortController();
          const running = Effect.runPromise(
            streamAgent(definition, 'x').pipe(
              Stream.tap((event) => {
                function recordAndAbort() {
                  seen.push(event);
                  controller.abort();
                  release();
                }

                return Effect.sync(recordAndAbort);
              }),
              Stream.runDrain,
              Effect.provide(service(base, auth))
            ),
            { signal: controller.signal }
          );

          await expect(running).rejects.toThrow();
          expect(seen).toStrictEqual([{ type: 'text-delta', text: 'partial' }]);
        }
      );
    } finally {
      release();
    }
  }
);

test.server.stable(
  'rejects empty model output without publishing completion',
  async ({ createAiMock, expect }) => {
    using mock = createAiMock();

    mock.next(definition, { input: 'x', output: '' });
    const seen: AgentProgress<string>[] = [];

    await expect(
      Effect.runPromise(
        streamAgent(definition, 'x').pipe(
          Stream.tap((event) => Effect.sync(() => seen.push(event))),
          Stream.runDrain,
          Effect.provide(mockService(mock))
        )
      )
    ).rejects.toThrow();
    expect(seen.some((event) => event.type === 'complete')).toBe(false);
  }
);

test.server.stable(
  'preserves note history in the native reply request',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const { replyAgent } = await import('#server/features/notes/agents/reply');
    let body = '';

    await peer(
      { assert },
      (_req, request) => {
        body = request;

        return send('read');
      },
      async (base, auth) => {
        const messages = [
          { role: 'user' as const, content: 'Earlier request' },
          { role: 'assistant' as const, content: 'Earlier answer' },
          { role: 'user' as const, content: 'Read these' }
        ];

        assert.ok(
          (await Effect.runPromise(
            generateAgent(replyAgent, { messages }).pipe(Effect.provide(service(base, auth)))
          )) === 'read'
        );

        for (const value of ['Earlier request', 'Earlier answer', 'Read these'])
          assert.ok(body.includes(value));

        const request = JSON.parse(body);

        expect(request.tools).toContainEqual({ type: 'web_search' });
        expect(request.tools).toContainEqual(
          expect.objectContaining({ type: 'function', name: 'sources' })
        );
      }
    );
  }
);

test.server.stable(
  'the Assistant keeps its local tools without gaining web search',
  async ({ resources: resourcesFixture, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { assistantAgent } = await import('#server/features/notes/agents/assistant');
    const fixture = resourcesFixture;
    const store = new ServerContext(await fixture.openDb());

    fixture.dispose(() => store.close());
    let body = '';

    await peer(
      { assert },
      (_req, request) => {
        body = request;

        return send('Local answer');
      },
      async (base, auth) => {
        await Effect.runPromise(
          generateAgent(assistantAgent, {
            messages: [{ role: 'user', content: 'Search online' }]
          }).pipe(Effect.provide(service(base, auth)), Effect.provideService(Database, { store }))
        );
        const tools = JSON.parse(body).tools;

        expect(tools.length).toBeGreaterThan(0);
        expect(tools.every((tool: { type: string }) => tool.type === 'function')).toBe(true);
      }
    );
  }
);

test.server.stable(
  'native web search completes inside the reply request without a local search executor',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { replyAgent } = await import('#server/features/notes/agents/reply');
    const answer = 'Verified with [OpenAI](https://openai.com/).';
    let requests = 0;

    await peer(
      { assert },
      (_req) => {
        requests++;
        let events = '';
        const item = {
          type: 'web_search_call',
          id: 'search-1',
          status: 'completed',
          action: {
            type: 'search',
            query: 'OpenAI',
            sources: [{ type: 'url', url: 'https://openai.com/' }]
          }
        };

        for (const event of [
          { type: 'response.output_item.added', output_index: 0, item },
          { type: 'response.output_item.done', output_index: 0, item },
          {
            type: 'response.output_item.added',
            output_index: 1,
            item: { type: 'message', id: 'm' }
          },
          { type: 'response.output_text.delta', item_id: 'm', delta: answer },
          { type: 'response.completed', response: {} }
        ])
          events += `data: ${eventJson(event)}\n\n`;

        return new Response(events, { headers: { 'content-type': 'text/event-stream' } });
      },
      async (base, auth) => {
        expect(
          await Effect.runPromise(
            generateAgent(replyAgent, {
              messages: [{ role: 'user', content: 'Check online' }]
            }).pipe(Effect.provide(service(base, auth)))
          )
        ).toBe(answer);
        expect(requests).toBe(1);
      }
    );
  }
);

test.server.stable(
  'agents without a web search declaration never receive native web search',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let body = '';

    await peer(
      { assert },
      (_req, request) => {
        body = request;

        return send('Local answer');
      },
      async (base, auth) => {
        await Effect.runPromise(
          generateAgent(definition, 'Search online').pipe(Effect.provide(service(base, auth)))
        );
        expect(JSON.parse(body).tools ?? []).not.toContainEqual(
          expect.objectContaining({ type: 'web_search' })
        );
      }
    );
  }
);

test.server.stable(
  'transcribes image and PDF bytes through the native vision API',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const { visionTranscriptionAgent } =
      await import('#server/features/sources/agents/vision-transcription');

    for (const [_kind, mime, expected] of [
      ['image', 'image/png', 'input_image'],
      ['pdf', 'application/pdf', 'input_file']
    ] as const) {
      let body = '';

      await peer(
        { assert },
        (_req, request) => {
          body = request;

          return send(
            JSON.stringify({ pages: [{ page: 1, blocks: [{ kind: 'paragraph', text: 'read' }] }] })
          );
        },
        async (base, auth) => {
          const result = await Effect.runPromise(
            generateAgent(visionTranscriptionAgent, {
              prompt: 'Transcribe page 1',
              data: new Uint8Array([1, 2, 3]),
              mediaType: mime
            }).pipe(Effect.provide(service(base, auth)))
          );

          assert.ok(result.pages[0].blocks[0].text === 'read');
          expect(body).toMatch(new RegExp(expected));
        }
      );
    }
  }
);

test.server.stable(
  'rejects invalid request limits before making a provider request',
  async ({ createAiMock, expect }) => {
    using mock = createAiMock();

    for (const options of [
      { maxSteps: 0 },
      { maxSteps: 21 },
      { maxRetries: -1 },
      { maxRetries: 6 }
    ]) {
      const error = await Effect.runPromise(
        Effect.flip(generateAgent(definition, 'x', options)).pipe(Effect.provide(mockService(mock)))
      );

      expect(error.kind).toBe('invalid_input');
    }

    const nesting = await Effect.runPromise(
      Effect.flip(generateAgent(definition, 'x')).pipe(
        Effect.provideService(ProcedureTraceScope, { parentRunId: null, path: '/full', depth: 16 }),
        Effect.provide(mockService(mock))
      )
    );

    expect(nesting.kind).toBe('invalid_input');
  }
);

test.server.stable(
  'preserves the typed provider error after retries are exhausted',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    await peer(
      { assert },
      (_req) => {
        return new Response(null, { status: 429 });
      },
      async (base, auth) => {
        const error = await Effect.runPromise(
          Effect.flip(generateAgent(definition, 'x')).pipe(Effect.provide(service(base, auth)))
        );

        assert.ok(error.kind === 'rate_limited');
        assert.strictEqual(error.name, 'ChatGptRequestError');
      }
    );
  }
);

test.server.stable(
  'canonical quiz agent accepts exactly one correct choice and rejects inconsistent answers',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const { quizAgent } = await import('#server/features/materials/agents/quiz');
    let validAnswer = true;
    let requests = 0;

    await peer(
      { assert },
      (_req) => {
        requests++;

        return send(
          JSON.stringify({
            kind: 'quiz',
            questions: [
              {
                kind: 'single_choice',
                prompt: 'q',
                choices: [
                  { text: 'a', isCorrect: validAnswer },
                  { text: 'b', isCorrect: false }
                ],
                explanation: 'e'
              }
            ]
          })
        );
      },
      async (base, auth) => {
        const run = () =>
          Effect.runPromise(
            generateAgent({ ...quizAgent, context: undefined }, { prompt: 'Ask a question' }).pipe(
              Effect.provide(service(base, auth))
            )
          );

        assert.ok((await run()).questions[0]?.kind === 'single_choice');
        validAnswer = false;
        await expect(run()).rejects.toThrow();
        assert.strictEqual(requests, 2);
      }
    );
  }
);

test.server.stable(
  'generic model request checks fail in the typed lane before provider work',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    let calls = 0;

    await peer(
      { assert },
      (_req) => {
        calls++;

        return send('unexpected');
      },
      async (base, auth) => {
        const model = createChatGptModel({
          auth,
          modelId: 'test',
          baseUrl: base
        });
        const failure = await Effect.runPromise(
          Effect.flip(
            generateAgent(definition, 'question', {
              preflight: Effect.fail(new StudyError('cancelled', 'Ownership lost'))
            })
          ).pipe(
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

        assert.ok(failure.kind === 'cancelled');
        assert.strictEqual(calls, 0);
      }
    );
  }
);

test.server.stable(
  'slow consumers receive all large deltas and the validated completion',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const delta = 'x'.repeat(4096);
    const count = 80;

    await peer(
      { assert },
      (_req) => {
        const events = [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'm' }
          },
          ...Array.from({ length: count }, () => ({
            type: 'response.output_text.delta',
            item_id: 'm',
            delta
          })),
          { type: 'response.completed', response: {} }
        ];
        let index = 0;

        return new Response(
          new ReadableStream({
            pull(controller) {
              if (index === events.length) controller.close();
              else
                controller.enqueue(
                  new TextEncoder().encode(`data: ${eventJson(events[index++])}\n\n`)
                );
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        );
      },
      async (base, auth) => {
        const events = await Effect.runPromise(
          streamAgent(definition, 'x').pipe(
            Stream.tap(() => Effect.sleep('1 millis')),
            Stream.runCollect,
            Effect.provide(service(base, auth))
          )
        );
        const deltas = events.filter((event) => event.type === 'text-delta');

        assert.strictEqual(deltas.map((event) => event.text).join(''), delta.repeat(count));
        expect(events.at(-1)).toStrictEqual({ type: 'complete', output: delta.repeat(count) });
      }
    );
  }
);

test.server.stable(
  'never retries a failed response after publishing a delta',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let calls = 0;
    let finish!: () => void;

    await peer(
      { assert },
      (_req) => {
        calls++;

        return new Response(
          new ReadableStream({
            start(controller) {
              const events = [
                {
                  type: 'response.output_item.added',
                  output_index: 0,
                  item: { type: 'message', id: 'm' }
                },
                { type: 'response.output_text.delta', item_id: 'm', delta: 'partial' }
              ];

              for (const event of events)
                controller.enqueue(new TextEncoder().encode(`data: ${eventJson(event)}\n\n`));

              finish = () => controller.close();
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        );
      },
      async (base, auth) => {
        const seen: string[] = [];

        await expect(
          Effect.runPromise(
            streamAgent(definition, 'x', { maxRetries: 3 }).pipe(
              Stream.tap((event) => {
                function recordEventType() {
                  seen.push(event.type);
                  finish();
                }

                return Effect.sync(recordEventType);
              }),
              Stream.runDrain,
              Effect.provide(service(base, auth))
            )
          )
        ).rejects.toThrow();
        expect(seen).toStrictEqual(['text-delta']);
        assert.strictEqual(calls, 1);
      }
    );
  }
);

test.server.stable(
  'local interruption closes the request without retries or durable cancellation',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let calls = 0;
    const observed: string[] = [];
    let closed!: () => void;
    const requestClosed = new Promise<void>((resolve) => {
      closed = resolve;
    });

    const observe: NonNullable<AgentsConfig['observe']> = (observation) =>
      Effect.sync(() => {
        observed.push(observation.event.type);
      });

    await peer(
      { assert },
      (_req) => {
        calls++;
        _req.signal.addEventListener('abort', closed, { once: true });

        return new Response(new ReadableStream({ start() {} }), {
          headers: { 'content-type': 'text/event-stream' }
        });
      },
      async (base, auth) => {
        const controller = new AbortController();
        const running = Effect.runPromise(
          streamAgent(definition, 'x', { maxRetries: 3 }).pipe(
            Stream.runDrain,
            Effect.provide(service(base, auth, observe))
          ),
          { signal: controller.signal }
        );

        while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 5));

        controller.abort();
        await expect(running).rejects.toThrow();
        await requestClosed;
        assert.strictEqual(calls, 1);
        expect(observed).toStrictEqual(['start']);
      }
    );
  }
);

test.server.stable(
  'decoder exceptions remain typed input failures before provider work',
  async ({ createAiMock, assert: assertions }) => {
    const assert: test.Assert = assertions;

    using mock = createAiMock();

    const guarded = defineAgent({
      ...definition,
      input: Schema.Struct({ prompt: Schema.String }),
      prompt: (input) => input.prompt
    });
    const input = {
      get prompt(): string {
        throw new Error('private decoder failure');
      }
    };
    const failure = await Effect.runPromise(
      Effect.flip(generateAgent(guarded, input)).pipe(Effect.provide(mockService(mock)))
    );

    assert.ok(failure.kind === 'invalid_input');
    assert.ok(failure.message === 'Invalid agent input');
  }
);

test.server.stable(
  'injects only selected rules, composes title rules and reloads preferences for each run',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let rules = {
      ...defaultAgentRules,
      quizzes: 'Use application questions.',
      titles: 'Use descriptive titles.',
      pages: 'UNRELATED DOCUMENT RULE'
    };
    const bodies: string[] = [];

    await peer(
      { assert },
      (_req, body) => {
        bodies.push(body);

        return send('ok');
      },
      async (base, auth) => {
        const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
        const configured = layer({
          model: () => Effect.succeed(model),
          language: 'en',
          searchSources: () => Effect.succeed([]),
          rules: Effect.sync(() => rules)
        });
        const agent = defineAgent({
          ...definition,
          customRules: [AgentRule.Quizzes, AgentRule.Titles],
          instructions: (language) => `Base instructions in ${language}`
        });
        const run = () =>
          Effect.runPromise(generateAgent(agent, 'question').pipe(Effect.provide(configured)));

        await run();
        expect(bodies[0]).toContain('Base instructions in en');
        expect(bodies[0]).toContain('Use application questions.');
        expect(bodies[0]).toContain('Use descriptive titles.');
        expect(bodies[0]).not.toContain('UNRELATED DOCUMENT RULE');
        rules = { ...rules, quizzes: 'Updated quiz preference.', titles: '   ' };
        await run();
        expect(bodies[1]).toContain('Updated quiz preference.');
        expect(bodies[1]).not.toContain('Use application questions.');
        expect(bodies[1]).not.toContain('Use descriptive titles.');
        rules = defaultAgentRules;
        await run();
        expect(bodies[2]).not.toContain('User preferences');
        expect(bodies[2]).toContain('Base instructions in en');
      }
    );
  }
);

test.server.stable(
  'records provider usage even when an agent rejects the generated output',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const records: { input: number; output: number; incomplete: boolean }[] = [];
    const recordUsage: NonNullable<AgentsConfig['recordUsage']> = (record) =>
      Effect.sync(() => {
        records.push(record);
      });

    await peer(
      { assert },
      (_req) => send('not valid JSON'),
      async (base, auth) => {
        const exit = await Effect.runPromise(
          Effect.exit(
            generateAgent(objectDefinition, 'count').pipe(
              Effect.provide(service(base, auth, undefined, recordUsage))
            )
          )
        );

        expect(exit._tag).toBe('Failure');
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ input: 0, output: 0, incomplete: true });
      }
    );
  }
);

test.server.stable(
  'retains provider-reported tokens when ChatGPT truncates a response',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const records: { input: number; output: number }[] = [];
    const recordUsage: NonNullable<AgentsConfig['recordUsage']> = (record) =>
      Effect.sync(() => {
        records.push(record);
      });

    await peer(
      { assert },
      (_req) => {
        let events = '';

        for (const event of [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'm' }
          },
          { type: 'response.output_text.delta', item_id: 'm', delta: 'Partial answer' },
          {
            type: 'response.incomplete',
            response: {
              incomplete_details: { reason: 'max_output_tokens' },
              usage: {
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                input_tokens_details: { cached_tokens: 80 },
                output_tokens_details: { reasoning_tokens: 5 }
              }
            }
          }
        ])
          events += `data: ${eventJson(event)}\n\n`;

        return new Response(events, { headers: { 'content-type': 'text/event-stream' } });
      },
      async (base, auth) => {
        const exit = await Effect.runPromise(
          Effect.exit(
            generateAgent(definition, 'cells').pipe(
              Effect.provide(service(base, auth, undefined, recordUsage))
            )
          )
        );

        expect(exit._tag).toBe('Failure');
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          input: 100,
          output: 20,
          cacheRead: 80,
          reasoning: 5,
          incomplete: false
        });
      }
    );
  }
);

test.server.stable(
  'decodes JSON optional identifiers in structured agent output before publication',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const generated = {
      title: 'Cells',
      content: {
        kind: 'flashcards',
        cards: [
          { cardId: null, front: 'Nucleus?', back: 'Stores DNA' },
          { cardId: '7', front: 'Ribosome?', back: 'Makes proteins' }
        ]
      }
    };

    await peer(
      { assert },
      (_req) => send(JSON.stringify(generated)),
      async (base, auth) => {
        const result = await Effect.runPromise(
          generateAgent(
            { ...objectDefinition, output: titledFlashcardsGenerationOutputSchema },
            'Cells'
          ).pipe(Effect.provide(service(base, auth)))
        );

        expect(result).toStrictEqual({
          ...generated,
          content: {
            ...generated.content,
            cards: [
              { front: 'Nucleus?', back: 'Stores DNA' },
              { ...generated.content.cards[1], cardId: 7n }
            ]
          }
        });
      }
    );
  }
);

test.server.stable(
  'model adapters receive the actual agent contract and validated input',
  async ({ createAiMock, expect }) => {
    using mock = createAiMock();

    const expected = mock.next(definition, { input: 'cells', output: 'Biology' });
    const output = await Effect.runPromise(
      generateAgent(definition, 'cells').pipe(
        Effect.provide(
          layer({
            model: (tier, call) => {
              expect(call.definition).toBe(definition);
              expect(call.input).toBe('cells');

              return mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError));
            },
            language: 'en',
            rules: Effect.succeed(defaultAgentRules),
            searchSources: () => Effect.succeed([])
          })
        )
      )
    );

    expect((await expected.called).input).toBe('cells');
    expect(output).toBe('Biology');
  }
);

test.server.stable(
  'internal provider retries cannot consume the next agent invocation expectation',
  async ({ createAiMock, expect }) => {
    using mock = createAiMock();
    const unavailable = new StudyError('transient', 'Try this logical call again later');

    mock.failNext(definition, { input: 'cells', error: unavailable });
    mock.next(definition, { input: 'cells', output: 'The next logical call' });
    const services = layer({
      model: (tier, call) => mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError)),
      language: 'en',
      rules: Effect.succeed(defaultAgentRules),
      searchSources: () => Effect.succeed([])
    });

    const failed = await Effect.runPromise(
      generateAgent(definition, 'cells', { maxRetries: 1 }).pipe(
        Effect.flip,
        Effect.provide(services)
      )
    );

    expect(failed.kind).toBe('transient');
    expect(
      await Effect.runPromise(generateAgent(definition, 'cells').pipe(Effect.provide(services)))
    ).toBe('The next logical call');
  }
);

test.server.stable(
  'material source preparation omits copied history input from durable traces',
  async ({ expect, assert: assertions }) => {
    const { studyNotesAgent } = await import('#server/features/materials/agents/study-notes');
    const notes = { notes: [{ text: 'ATP carries energy', markers: [1] }] };
    const assert: test.Assert = assertions;
    const observations: Parameters<NonNullable<AgentsConfig['observe']>>[0][] = [];
    const observe: NonNullable<AgentsConfig['observe']> = (observation) =>
      Effect.sync(() => {
        observations.push(observation);
      });

    await peer(
      { assert },
      () => send(JSON.stringify(notes)),
      async (base, auth) => {
        const output = await Effect.runPromise(
          generateAgent(studyNotesAgent, {
            prompt: 'Request containing private history and original passages [1]'
          }).pipe(Effect.provide(service(base, auth, observe)))
        );

        expect(output).toEqual(notes);
        expect(observations.length).toBeGreaterThan(0);

        for (const observation of observations) expect(observation.trace?.input).toBeUndefined();
      }
    );
  }
);

test.server.stable(
  'repeated agent calls keep distinct native child checkpoints when provider tool IDs repeat',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;
    const location = await databases();
    const context = new ServerContext(await location.open());
    const inputs: number[] = [];
    let requests = 0;
    const child = defineProcedure({
      id: 'remember',
      purpose: 'operation',
      input: Schema.Struct({ value: Schema.Number }),
      output: Schema.Number,
      execute: ({ value }) =>
        Effect.sync(() => {
          inputs.push(value);

          return value;
        })
    });
    const capability = procedureTool(child, {
      description: 'Remember a value',
      mutates: false,
      wiki: { when: 'Remember a value', examples: ['Remember one'], limits: 'One number' }
    });
    const agent = defineAgent({ ...definition, tools: { remember: capability } });
    const parent = defineProcedure({
      id: 'repeat-agent',
      purpose: 'procedure',
      input: Schema.Void,
      output: Schema.Array(Schema.String),
      execute: () =>
        Effect.gen(function* () {
          const first = yield* generateAgent(agent, 'one');
          const second = yield* generateAgent(agent, 'two');

          return [first, second];
        })
    });
    const workflow = Workflow.make('repeated-agent-tools', {
      payload: {},
      success: Schema.Array(Schema.String),
      error: failureSchema,
      idempotencyKey: () => 'one'
    });

    const executeParent = () => runProcedure(parent, undefined, { key: 'root', retry: false });

    try {
      await peer(
        { assert },
        () => {
          requests++;

          if (requests % 2 === 0) return send('Remembered');

          const item = {
            type: 'function_call',
            id: 'item',
            call_id: 'call1',
            name: 'remember',
            arguments: JSON.stringify({ value: (requests + 1) / 2 })
          };

          return eventsResponse([
            { type: 'response.output_item.added', output_index: 0, item },
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: { ...item, status: 'completed' }
            },
            { type: 'response.completed', response: {} }
          ]);
        },
        async (base, auth) => {
          const results = await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const engine = yield* WorkflowEngine.WorkflowEngine;

                yield* engine.register(workflow, executeParent);
                admitTestExecution(context, workflow, 'one', {});

                return yield* engine.execute(workflow, { executionId: 'one', payload: {} });
              }).pipe(
                Effect.provide(service(base, auth, observeAgentProgress(context))),
                Effect.provideService(Database, { store: context }),
                Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('one') }),
                Effect.provide(workflowEngineLayer(context))
              )
            )
          );

          expect(results).toEqual(['Remembered', 'Remembered']);
          expect(inputs).toEqual([1, 2]);
        }
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

for (const { transient, parallel } of [
  { transient: false, parallel: 1 },
  { transient: true, parallel: 1 },
  { transient: false, parallel: 2 }
]) {
  test.server.stable(
    `a tool-delegated child agent completes with one shared provider permit (transient ${transient}, tools ${parallel})`,
    async ({ databases, expect, assert: assertions }) => {
      const assert: test.Assert = assertions;
      const location = await databases();
      const context = new ServerContext(await location.open());
      const admission = makeAdmission({ concurrency: 1 });
      let requests = 0;
      let childRequests = 0;
      let parentRequests = 0;
      let activeChildren = 0;
      let peakChildren = 0;
      const child = defineProcedure({
        id: 'delegate-child',
        purpose: 'response',
        input: Schema.Struct({ prompt: Schema.String }),
        output: Schema.String,
        execute: ({ prompt }) =>
          Effect.sync(() => {
            activeChildren++;
            peakChildren = Math.max(peakChildren, activeChildren);
          }).pipe(
            Effect.andThen(generateAgent(definition, prompt)),
            Effect.ensuring(
              Effect.sync(() => {
                activeChildren--;
              })
            )
          )
      });
      const parent = defineAgent({
        ...definition,
        id: 'delegate-parent',
        tools: {
          delegate: procedureTool(child, {
            description: 'Delegate to a child',
            mutates: false,
            wiki: { when: 'Delegate', examples: ['Ask a child'], limits: 'One child' }
          })
        }
      });
      const root = defineProcedure({
        id: 'delegate-root',
        purpose: 'procedure',
        input: Schema.String,
        output: Schema.String,
        execute: (input) => generateAgent(parent, input)
      });
      const executeParent = () => runProcedure(root, 'parent', { key: 'root', retry: false });
      const workflow = Workflow.make('nested-agent-admission', {
        payload: {},
        success: Schema.String,
        error: failureSchema,
        idempotencyKey: () => 'one'
      });

      try {
        await peer(
          { assert },
          (_, body) => {
            requests++;

            if (body.includes('function_call_output')) return send('Parent answer');

            if (!JSON.stringify(JSON.parse(body)).includes('"parent"')) {
              childRequests++;

              return transient && childRequests === 1
                ? new Response('unavailable', { status: 503 })
                : send('Child answer');
            }

            parentRequests++;
            const items = Array.from({ length: parallel }, (_, index) => ({
              type: 'function_call',
              id: `item-${index}`,
              call_id: `delegate-call-${parentRequests}-${index}`,
              name: 'delegate',
              arguments: JSON.stringify({ prompt: `child-${index}` })
            }));

            return eventsResponse([
              ...items.flatMap((item, index) => [
                { type: 'response.output_item.added', output_index: index, item },
                {
                  type: 'response.output_item.done',
                  output_index: index,
                  item: { ...item, status: 'completed' }
                }
              ]),
              { type: 'response.completed', response: {} }
            ]);
          },
          async (base, auth) => {
            const result = await Effect.runPromise(
              Effect.scoped(
                Effect.gen(function* () {
                  const engine = yield* WorkflowEngine.WorkflowEngine;

                  yield* engine.register(workflow, executeParent);
                  admitTestExecution(context, workflow, 'one', {});

                  const first = yield* engine.execute(workflow, {
                    executionId: 'one',
                    payload: {}
                  });
                  const count = requests;

                  expect(yield* engine.execute(workflow, { executionId: 'one', payload: {} })).toBe(
                    first
                  );
                  expect(requests).toBe(count);

                  return first;
                }).pipe(
                  Effect.timeout('5 seconds'),
                  Effect.updateService(Agents, (agents) => ({ ...agents, admission })),
                  Effect.provide(service(base, auth, observeAgentProgress(context))),
                  Effect.provideService(Database, { store: context }),
                  Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('one') }),
                  Effect.provide(workflowEngineLayer(context))
                )
              )
            );

            expect(result).toBe('Parent answer');
            expect(childRequests).toBe(transient ? 2 : parallel);
            expect(peakChildren).toBe(1);
            expect(activeChildren).toBe(0);
            expect(requests).toBe(transient ? 5 : parallel + 2);
            const childAttempts = context.db.orm
              .select()
              .from(workflow_agent_progress)
              .all()
              .filter((row) => row.agent_id === 'delegate-child')
              .map((row) => row.attempt);

            expect(childAttempts).toEqual(
              transient ? [1n, 2n] : Array.from({ length: parallel }, () => 1n)
            );

            if (transient) expect(parentRequests).toBe(2);
          }
        );
      } finally {
        context.close();
        await location.cleanup();
      }
    }
  );
}

for (const [status, kind] of [
  [402, 'config'],
  [404, 'model_unavailable'],
  [405, 'unsupported']
] as const) {
  test.server.stable(
    `preserves native provider HTTP ${status} classification`,
    async ({ expect }) => {
      const model = deepseek.createModel({
        apiKey: 'test',
        modelId: 'test',
        fetch: async () => new Response(null, { status })
      });
      const error = await Effect.runPromise(
        Effect.flip(generateAgent(definition, 'question')).pipe(
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

      expect(error.kind).toBe(kind);
    }
  );
}

for (const phase of ['prompt', 'schema'] as const) {
  test.server.stable(
    `synchronous ${phase} builder failures stay typed and sanitize private details`,
    async ({ expect }) => {
      let requests = 0;
      const model = deepseek.createModel({
        apiKey: 'test',
        modelId: 'test',
        fetch: async () => {
          requests++;

          return new Response(null, { status: 400 });
        }
      });

      if (phase === 'schema')
        Object.assign(model, {
          withOutputSchema: () => {
            throw new Error('private schema details');
          }
        });

      const target = {
        ...definition,
        mode: 'object' as const,
        output: Schema.Struct({ answer: Schema.String }),
        prompt: (input: string) => {
          if (phase === 'prompt') throw new Error('private prompt details');

          return input;
        }
      };
      const error = await Effect.runPromise(
        Effect.flip(generateAgent(target, 'question', { maxRetries: 0 })).pipe(
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

      expect(error).toBeInstanceOf(StudyError);
      expect(error.kind).toBe('transient');
      expect(error.message).toBe('Agent request failed');
      expect(requests).toBe(0);
    }
  );
}
