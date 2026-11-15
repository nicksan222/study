/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises automatic document preparation with reusable typed agent policies.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies bounded generation, source isolation and original passage provenance.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native workflows own checkpoints and provider fixtures replace only model responses.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { promptInputSchema } from '@study/contracts/ai/shared';
import { failureSchema, StudyError } from '@study/contracts/errors';
import { AgentRule } from '@study/contracts/settings/schemas';
import { defaultAgentRules } from '@study/contracts/settings/types';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { Workflow, WorkflowEngine } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { Agents } from '#server/platform/ai/agents';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { sourcesTool } from '#server/platform/ai/captured-sources-tool';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { defineAgent } from '#server/platform/definitions/define-agent';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';

import { defineDocumentPreparation, generateDocumentAgent } from './agent.ts';
import type { processDocumentPieces } from './runner.ts';
import { document } from './test-helpers.ts';

const notesSchema = Schema.Struct({
  notes: Schema.Array(Schema.Struct({ text: Schema.String, markers: Schema.Array(Schema.Number) }))
});

const notesAgent = defineAgent({
  id: 'prepared-notes',
  input: promptInputSchema,
  output: notesSchema,
  model: 'tiny',
  mode: 'object',
  customRules: [AgentRule.Replies],
  instructions: 'Extract or combine',
  prompt: ({ prompt }) => prompt
});

const replyAgent = defineAgent({
  id: 'prepared-reply',
  input: Schema.Struct({ request: Schema.String }),
  output: Schema.String,
  model: 'tiny',
  customRules: [AgentRule.Replies],
  instructions: 'Reply',
  prompt: ({ request }) => `Original agent prompt: ${request}`
});

const alternateAgent = defineAgent({
  ...replyAgent,
  id: 'prepared-alternate',
  prompt: ({ request }: { request: string }) => [
    { role: 'user' as const, content: `Alternate original: ${request}` }
  ]
});

const preparation = defineDocumentPreparation({
  name: 'reusable-preparation-v1',
  referenceSchema: Schema.String,
  mappedSchema: notesSchema,
  direct: { empty: { notes: [] } },
  map: { agent: notesAgent, instruction: (task: string) => `Map task: ${task}` },
  reduce: { agent: notesAgent, instruction: (task: string) => `Reduce task: ${task}` },
  markers: (value) => value.notes.flatMap((note) => note.markers),
  render: (value) =>
    value.notes
      .map((note) => `${note.text} ${note.markers.map((marker) => `[${marker}]`).join(' ')}`)
      .join('\n'),
  planLimits: {
    maxPassageChars: 1000,
    maxPieceChars: 1000,
    maxPieceBytes: 10000,
    maxPlanChars: 10000,
    maxPlanBytes: 100000,
    maxPieces: 20
  },
  limits: { maxResultBytes: 5000, maxReductionBytes: 10000, maxFanout: 2, maxLevels: 8 },
  promptLimits: { maxBytes: 20000, reservedBytes: 100 }
});

function fixtureModel(prompts: string[]): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'fixture',
    modelId: 'fixture',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('Streaming required');
    },
    doStream: async (input) => {
      const prompt = JSON.stringify(input.prompt);

      prompts.push(prompt);

      if (
        prompt.includes('Search isolated sources') &&
        !input.prompt.some((message) => message.role === 'tool')
      )
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'isolated-search',
                toolName: 'sources',
                input: JSON.stringify({ query: 'shared' })
              });
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 1, reasoning: 0 }
                }
              });
              controller.close();
            }
          })
        };

      const text =
        prompt.includes('Map task:') || prompt.includes('Reduce task:')
          ? JSON.stringify({
              notes: [
                { text: 'Prepared concept', markers: [Number(prompt.match(/\[(\d+)\]/)?.[1] ?? 1)] }
              ]
            })
          : 'Final [1]';

      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'text' });
            controller.enqueue({ type: 'text-delta', id: 'text', delta: text });
            controller.enqueue({ type: 'text-end', id: 'text' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 }
              }
            });
            controller.close();
          }
        })
      };
    }
  };
}

async function run<A, E>(
  effect: Effect.Effect<
    A,
    E,
    Effect.Services<ReturnType<typeof processDocumentPieces<string, string, never>>> | Agents
  >,
  schema: Schema.Codec<A, unknown>,
  prompts: string[]
) {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const workflow = Workflow.make('PreparedDocumentAgentFixture', {
    payload: {},
    success: schema,
    error: failureSchema,
    idempotencyKey: () => 'one'
  });
  const model = fixtureModel(prompts);

  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () =>
            effect.pipe(
              Effect.mapError(() => new StudyError('internal', 'Fixture execution failed'))
            )
          );

          return yield* engine.execute(workflow, { executionId: 'one', payload: {} });
        }).pipe(
          Effect.provideService(Database, { store: context }),
          Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('fixed') }),
          Effect.provide(
            agentsLayer({
              model: () => Effect.succeed(model),
              language: 'en',
              rules: Effect.succeed(defaultAgentRules),
              searchSources: () => Effect.die('Global evidence must remain isolated')
            })
          ),
          Effect.provide(WorkflowEngine.layerMemory)
        )
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
}

testStable(
  'reuses preparation across distinct agents without extra model work for small inputs',
  async () => {
    const prompts: string[] = [];
    const original = document(['Original exact evidence']);
    const execute = Effect.gen(function* () {
      const options = {
        scope: 'first-invocation',
        task: 'Learn',
        preparation,
        preflight: Effect.void,
        documents: [
          {
            key: 'one',
            reference: 'version-one',
            load: Effect.succeed({ name: 'Original', document: original })
          }
        ]
      };
      const first = yield* generateDocumentAgent(replyAgent, { request: 'one' }, options);
      const second = yield* generateDocumentAgent(
        alternateAgent,
        { request: 'two' },
        {
          ...options,
          scope: 'second-invocation',
          task: 'Different task',
          documents: [
            {
              key: 'two',
              reference: 'version-two',
              load: Effect.succeed({
                name: 'Another',
                document: document(['Another original evidence'])
              })
            }
          ]
        }
      );
      const secondCitations = yield* second.evidence.citations(second.output);

      assert.equal(secondCitations[0]!.reference, 'version-two');
      assert.equal(secondCitations[0]!.quote, 'Another original evidence');
      const citations = yield* first.evidence.citations(first.output);

      assert.equal(citations[0]!.quote, original.blocks[0]!.text);
      assert.equal(citations[0]!.reference, 'version-one');
      assert.deepEqual(citations[0]!.target, {
        blockId: original.blocks[0]!.id,
        start: 0,
        end: original.blocks[0]!.text.length
      });
      assert.deepEqual(citations[0]!.anchor, { type: 'authored' });

      return second.output;
    });

    assert.equal(await run(execute, Schema.String, prompts), 'Final [1]');
    assert.equal(prompts.length, 2);
    assert.include(prompts[0]!, 'Original agent prompt: one');
    assert.include(prompts[1]!, 'Alternate original: two');
  }
);

testStable('rejects oversized prompts before admitting provider work', async () => {
  const prompts: string[] = [];
  const execute = generateDocumentAgent(
    replyAgent,
    { request: 'x'.repeat(30000) },
    {
      scope: 'one',
      task: 'Learn',
      preparation,
      preflight: Effect.void,
      documents: [
        {
          key: 'one',
          reference: 'v1',
          load: Effect.succeed({ name: 'Original', document: document(['exact']) })
        }
      ]
    }
  ).pipe(
    Effect.flip,
    Effect.map((error) => error.kind)
  );

  assert.equal(await run(execute, Schema.String, prompts), 'not_enough');
  assert.equal(prompts.length, 0);
});

testStable('binds source tools to each run without mutating the caller environment', async () => {
  const searchingAgent = defineAgent({
    ...replyAgent,
    id: 'prepared-searching',
    tools: { sources: sourcesTool }
  });
  const check = (label: string) =>
    Effect.gen(function* () {
      const parent = yield* Agents;
      const generated = yield* generateDocumentAgent(
        searchingAgent,
        { request: 'Search isolated sources' },
        {
          scope: 'one',
          task: 'Learn',
          preparation,
          preflight: Effect.void,
          documents: [
            {
              key: label,
              reference: label,
              load: Effect.succeed({ name: label, document: document([`shared ${label}`]) })
            }
          ]
        }
      );

      assert.strictEqual((yield* Agents).searchSources, parent.searchSources);
      const citations = yield* generated.evidence.citations(generated.output);

      assert.equal(citations[0]!.reference, label);

      return generated.output;
    });
  const first: string[] = [],
    second: string[] = [];

  await run(check('first-only'), Schema.String, first);
  await run(check('second-only'), Schema.String, second);
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.include(first[1]!, 'shared first-only');
  assert.notInclude(first[1]!, 'second-only');
  assert.include(second[1]!, 'shared second-only');
  assert.notInclude(second[1]!, 'first-only');
});

testStable(
  'retains explicit selected original ranges and excludes unselected evidence',
  async () => {
    const original = document(['prefix selected suffix']);
    const execute = Effect.gen(function* () {
      const result = yield* generateDocumentAgent(
        replyAgent,
        { request: 'Select' },
        {
          scope: 'one',
          task: 'Learn',
          preparation,
          preflight: Effect.void,
          selection: {
            mode: 'selected',
            ranges: [{ documentKey: 'one', blockId: original.blocks[0]!.id, start: 7, end: 15 }]
          },
          documents: [
            {
              key: 'one',
              reference: 'exact',
              load: Effect.succeed({ name: 'Original', document: original })
            }
          ]
        }
      );

      assert.equal(result.coverage.mode, 'selected');
      const citation = (yield* result.evidence.citations(result.output))[0]!;

      assert.equal(citation.quote, 'selected');
      assert.deepEqual(citation.target, { blockId: original.blocks[0]!.id, start: 7, end: 15 });

      return result.output;
    });
    const prompts: string[] = [];

    await run(execute, Schema.String, prompts);
    assert.notInclude(prompts[0]!, 'prefix');
    assert.notInclude(prompts[0]!, 'suffix');
  }
);

testStable('preparation agents search only their piece or reduction originals', async () => {
  const prompts: string[] = [];
  const searchingNotes = { ...notesAgent, tools: { sources: sourcesTool } };
  const execute = generateDocumentAgent(
    replyAgent,
    { request: 'Final synthesis' },
    {
      scope: 'scoped-preparation',
      task: 'Search isolated sources',
      preparation: {
        ...preparation,
        map: { ...preparation.map, agent: searchingNotes },
        reduce: { ...preparation.reduce, agent: searchingNotes }
      },
      preflight: Effect.void,
      documents: [
        {
          key: 'originals',
          reference: 'original-version',
          load: Effect.succeed({
            name: 'Originals',
            document: document([
              'shared first-piece '.padEnd(1000, 'a'),
              'shared second-piece '.padEnd(1000, 'b')
            ])
          })
        }
      ]
    }
  ).pipe(Effect.map(({ output }) => output));

  assert.equal(await run(execute, Schema.String, prompts), 'Final [1]');
  const maps = prompts.filter(
    (prompt) => prompt.includes('Map task:') && prompt.includes('tool-result')
  );

  assert.equal(maps.length, 2);
  assert.include(maps[0]!, 'first-piece');
  assert.notInclude(maps[0]!, 'second-piece');
  assert.include(maps[1]!, 'second-piece');
  assert.notInclude(maps[1]!, 'first-piece');
  const reductions = prompts.filter(
    (prompt) => prompt.includes('Reduce task:') && prompt.includes('tool-result')
  );

  assert.equal(reductions.length, 1);
  assert.include(reductions[0]!, 'first-piece');
  assert.include(reductions[0]!, 'second-piece');
});

testStable('invalid final agent input fails before multi-piece provider work', async () => {
  const prompts: string[] = [];
  const execute = generateDocumentAgent(
    replyAgent,
    { request: 42 as unknown as string },
    {
      scope: 'invalid-input',
      task: 'Learn',
      preparation,
      preflight: Effect.void,
      documents: [
        {
          key: 'one',
          reference: 'original',
          load: Effect.succeed({
            name: 'Original',
            document: document(['a'.repeat(600), 'b'.repeat(600)])
          })
        }
      ]
    }
  ).pipe(
    Effect.flip,
    Effect.map((error) => error.kind)
  );

  assert.equal(await run(execute, Schema.String, prompts), 'invalid_input');
  assert.equal(prompts.length, 0);
});
