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
import type { agentObservationSchema } from '@study/contracts';
import { promptInputSchema } from '@study/contracts';
import { failureSchema, StudyError } from '@study/contracts';
import { AgentRule } from '@study/contracts';
import { defaultAgentRules } from '@study/contracts';
import type { createTestDatabase } from '@study/db/testing';
import { test } from '@study/testing';
import { Effect, Schema, Stream } from 'effect';
import { Workflow, WorkflowEngine } from 'effect/workflow';

import { Agents, generateAgent, streamAgent } from '#server/platform/ai/agents';
import type { AgentsConfig } from '#server/platform/ai/agents';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { sourcesTool } from '#server/platform/ai/captured-sources-tool';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { defineAgent } from '#server/platform/definitions/define-agent';
import type { AgentDefinition } from '#server/platform/definitions/define-agent';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';

import { defineContextPreparation } from './agent.ts';
import type { processSourcePassages } from './runner.ts';
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

const preparationDefinition = {
  name: 'reusable-preparation-v1',
  map: { agent: notesAgent, instruction: (task: string) => `Map task: ${task}` },
  reduce: { agent: notesAgent, instruction: (task: string) => `Reduce task: ${task}` },
  markers: (value: typeof notesSchema.Type) => value.notes.flatMap((note) => note.markers),
  render: (value: typeof notesSchema.Type) =>
    value.notes
      .map((note) => `${note.text} ${note.markers.map((marker) => `[${marker}]`).join(' ')}`)
      .join('\n'),
  limits: {
    plan: {
      maxPassageChars: 1000,
      maxPieceChars: 1000,
      maxPieceBytes: 10000,
      maxPlanChars: 10000,
      maxPlanBytes: 100000,
      maxPieces: 20
    },
    reduction: { maxResultBytes: 5000, maxReductionBytes: 10000, maxFanout: 2, maxLevels: 8 },
    prompt: { maxBytes: 20000, reservedBytes: 100 }
  }
};

const preparation = defineContextPreparation(preparationDefinition);

function contextTypeContracts({ expectTypeOf }: Pick<test.Context, 'expectTypeOf'>) {
  const definition = { ...replyAgent, context: preparation };

  // @ts-expect-error A context-consuming agent cannot omit its captured inputs and ownership checks.
  generateAgent(definition, { request: 'Study cells' });
  // @ts-expect-error Preflight alone cannot substitute for captured inputs and a durable identity.
  generateAgent(definition, { request: 'Study cells' }, { preflight: Effect.void });

  const plain = generateAgent(replyAgent, { request: 'Study cells' });

  expectTypeOf<Effect.Success<typeof plain>>().toEqualTypeOf<string>();
}

void contextTypeContracts;

test.stable(
  'invalid invocation limits reject before any preparation model work',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const execute = generateAgent(
      { ...replyAgent, context: preparation },
      { request: 'Learn' },
      {
        scope: 'invalid-limits',
        maxSteps: 0,
        preflight: Effect.void,
        sources: {
          referenceSchema: Schema.String,
          documents: [
            {
              key: 'one',
              reference: 'original',
              load: Effect.succeed({
                name: 'Original',
                document: document([
                  'First section '.padEnd(1000, 'a'),
                  'Second section '.padEnd(1000, 'b')
                ])
              })
            }
          ]
        }
      }
    ).pipe(
      Effect.flip,
      Effect.map((error) => error.kind)
    );
    const prompts: string[] = [];

    assert.equal(await run(databases, execute, Schema.String, prompts), 'invalid_input');
    assert.lengthOf(prompts, 0);
  }
);

test.stable(
  'prepared context can recover an omitted original through scoped search',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const execute = Effect.gen(function* () {
      const prepared = yield* preparation.prepare('Learn', {
        scope: 'recover-original',
        preflight: Effect.void,
        sources: {
          referenceSchema: Schema.String,
          documents: [
            {
              key: 'one',
              reference: 'original-version',
              load: Effect.succeed({
                name: 'Original',
                document: document([
                  'Front concept '.padEnd(1000, 'a'),
                  'Rare-tail concept '.padEnd(1000, 'b')
                ])
              })
            }
          ]
        }
      });

      assert.equal((yield* Effect.flip(prepared.evidence.citations('[2]'))).kind, 'invalid_input');
      assert.equal(prepared.search('Rare-tail')[0]?.id, '2');
      const citation = (yield* prepared.evidence.citations('[2]'))[0]!;

      assert.equal(citation.reference, 'original-version');
      assert.include(citation.quote, 'Rare-tail concept');

      return 'Recovered original';
    });

    await run(databases, execute, Schema.String, []);
  }
);

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
  databases: (folder?: string) => Promise<Awaited<ReturnType<typeof createTestDatabase>>>,
  effect: Effect.Effect<
    A,
    E,
    Effect.Services<ReturnType<typeof processSourcePassages<string, string, never>>> | Agents
  >,
  schema: Schema.Codec<A, unknown>,
  prompts: string[],
  observations: (typeof agentObservationSchema.Type)[] = [],
  provider?: AgentsConfig['model']
) {
  const location = await databases();
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
              Effect.mapError((error) =>
                error instanceof StudyError
                  ? error
                  : new StudyError('internal', 'Fixture execution failed')
              )
            )
          );

          return yield* engine.execute(workflow, { executionId: 'one', payload: {} });
        }).pipe(
          Effect.provideService(Database, { store: context }),
          Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('fixed') }),
          Effect.provide(
            agentsLayer({
              model: provider ?? (() => Effect.succeed(model)),
              observe: (observation) =>
                Effect.sync(() => {
                  observations.push(observation);
                }),
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
  }
}

test.stable(
  'context agents accept decoded codec inputs before preparing their prompt',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const definition = defineAgent({
      ...replyAgent,
      context: preparation,
      input: Schema.Struct({ request: Schema.BigIntFromString }),
      prompt: ({ request }) => `Revision ${request}`
    });
    const execute = generateAgent(
      definition,
      { request: 3n },
      {
        scope: 'codec-input',
        preflight: Effect.void,
        sources: {
          referenceSchema: Schema.String,
          documents: [
            {
              key: 'one',
              reference: 'version-one',
              load: Effect.succeed({
                name: 'Original',
                document: document(['Original exact evidence'])
              })
            }
          ]
        }
      }
    ).pipe(Effect.map(({ output }) => output));
    const prompts: string[] = [];

    await run(databases, execute, Schema.String, prompts);
    assert.include(prompts[0]!, 'Revision 3');
  }
);

test.stable(
  'reuses preparation across distinct agents without extra model work for small inputs',
  async ({ databases, expectTypeOf, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const prompts: string[] = [];
    const original = document(['Original exact evidence']);
    const execute = Effect.gen(function* () {
      const options = {
        scope: 'first-invocation',
        preflight: Effect.void,
        sources: {
          referenceSchema: Schema.String,
          documents: [
            {
              key: 'one',
              reference: 'version-one',
              load: Effect.succeed({ name: 'Original', document: original })
            }
          ]
        }
      };
      const first = yield* generateAgent(
        { ...replyAgent, context: preparation },
        { request: 'one' },
        options
      );
      const second = yield* generateAgent(
        { ...alternateAgent, context: preparation },
        { request: 'two' },
        {
          ...options,
          scope: 'second-invocation',
          sources: {
            referenceSchema: Schema.String,
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
        }
      );
      const secondCitations = yield* second.evidence.citations(second.output);

      expectTypeOf(secondCitations[0]!.reference).toEqualTypeOf<string>();
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

    assert.equal(await run(databases, execute, Schema.String, prompts), 'Final [1]');
    assert.equal(prompts.length, 2);
    assert.include(prompts[0]!, 'Original agent prompt: one');
    assert.include(prompts[1]!, 'Alternate original: two');
  }
);

test.stable(
  'rejects oversized prompts before admitting provider work',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const prompts: string[] = [];
    const execute = generateAgent(
      { ...replyAgent, context: preparation },
      { request: 'x'.repeat(30000) },
      {
        scope: 'one',
        preflight: Effect.void,
        sources: {
          referenceSchema: Schema.String,
          documents: [
            {
              key: 'one',
              reference: 'v1',
              load: Effect.succeed({ name: 'Original', document: document(['exact']) })
            }
          ]
        }
      }
    ).pipe(
      Effect.flip,
      Effect.map((error) => error.kind)
    );

    assert.equal(await run(databases, execute, Schema.String, prompts), 'not_enough');
    assert.equal(prompts.length, 0);
  }
);

test.stable(
  'binds source tools to each run without mutating the caller environment',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const searchingAgent = defineAgent({
      ...replyAgent,
      id: 'prepared-searching',
      tools: { sources: sourcesTool }
    });
    const check = ({ assert: assertions }: Pick<test.Context, 'assert'>, label: string) => {
      const assert: test.Assert = assertions;

      return Effect.gen(function* () {
        const parent = yield* Agents;
        const generated = yield* generateAgent(
          { ...searchingAgent, context: preparation },
          { request: 'Search isolated sources' },
          {
            scope: 'one',
            preflight: Effect.void,
            sources: {
              referenceSchema: Schema.String,
              documents: [
                {
                  key: label,
                  reference: label,
                  load: Effect.succeed({ name: label, document: document([`shared ${label}`]) })
                }
              ]
            }
          }
        );

        assert.strictEqual((yield* Agents).searchSources, parent.searchSources);
        const citations = yield* generated.evidence.citations(generated.output);

        assert.equal(citations[0]!.reference, label);

        return generated.output;
      });
    };
    const first: string[] = [],
      second: string[] = [];

    await run(databases, check({ assert }, 'first-only'), Schema.String, first);
    await run(databases, check({ assert }, 'second-only'), Schema.String, second);
    assert.equal(first.length, 2);
    assert.equal(second.length, 2);
    assert.include(first[1]!, 'shared first-only');
    assert.notInclude(first[1]!, 'second-only');
    assert.include(second[1]!, 'shared second-only');
    assert.notInclude(second[1]!, 'first-only');
  }
);

test.stable(
  'retains explicit selected original ranges and excludes unselected evidence',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const original = document(['prefix selected suffix']);
    const execute = Effect.gen(function* () {
      const result = yield* generateAgent(
        { ...replyAgent, context: preparation },
        { request: 'Select' },
        {
          scope: 'one',
          preflight: Effect.void,
          sources: {
            referenceSchema: Schema.String,
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
        }
      );

      assert.equal(result.coverage.mode, 'selected');
      const citation = (yield* result.evidence.citations(result.output))[0]!;

      assert.equal(citation.quote, 'selected');
      assert.deepEqual(citation.target, {
        blockId: original.blocks[0]!.id,
        start: 7,
        end: 15
      });

      return result.output;
    });
    const prompts: string[] = [];

    await run(databases, execute, Schema.String, prompts);
    assert.notInclude(prompts[0]!, 'prefix');
    assert.notInclude(prompts[0]!, 'suffix');
  }
);

test.stable(
  'preparation agents search only their piece or reduction originals',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const prompts: string[] = [];
    const observations: (typeof agentObservationSchema.Type)[] = [];
    const searchingNotes = { ...notesAgent, tools: { sources: sourcesTool } };
    const execute = generateAgent(
      {
        ...replyAgent,
        context: defineContextPreparation({
          ...preparationDefinition,
          map: {
            agent: searchingNotes,
            instruction: (task: string) => `Map task: Search isolated sources ${task}`
          },
          reduce: {
            agent: searchingNotes,
            instruction: (task: string) => `Reduce task: Search isolated sources ${task}`
          }
        })
      },
      { request: 'Final synthesis' },
      {
        scope: 'scoped-preparation',
        preflight: Effect.void,
        sources: {
          referenceSchema: Schema.String,
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
      }
    ).pipe(Effect.map(({ output }) => output));

    assert.equal(await run(databases, execute, Schema.String, prompts, observations), 'Final [1]');
    assert.deepEqual(
      observations.filter(({ event }) => event.type === 'start').map(({ phase }) => phase),
      ['preparing', 'preparing', 'compacting', 'generating']
    );

    for (const observation of observations) {
      assert.equal(
        observation.phase,
        observations.find(({ runId }) => runId === observation.runId)!.phase
      );
    }

    const maps = prompts.filter(
      (prompt) => prompt.includes('Map task:') && prompt.includes('tool-result')
    );

    assert.equal(maps.length, 2);
    assert.include(maps[0]!, 'Original agent prompt: Final synthesis');
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
  }
);

test.stable(
  'invalid final agent input fails before multi-piece provider work',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const prompts: string[] = [];
    const execute = generateAgent(
      { ...replyAgent, context: preparation },
      { request: 42 as unknown as string },
      {
        scope: 'invalid-input',
        preflight: Effect.void,
        sources: {
          referenceSchema: Schema.String,
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
      }
    ).pipe(
      Effect.flip,
      Effect.map((error) => error.kind)
    );

    assert.equal(await run(databases, execute, Schema.String, prompts), 'invalid_input');
    assert.equal(prompts.length, 0);
  }
);

test.stable(
  'compresses one piece when the assembled final prompt cannot pass directly',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const prompts: string[] = [];
    const execute = generateAgent(
      {
        ...replyAgent,
        context: defineContextPreparation({
          ...preparationDefinition,
          limits: {
            ...preparationDefinition.limits,
            plan: { ...preparationDefinition.limits.plan, maxPieceChars: 10_000 },
            prompt: { maxBytes: 12_000, reservedBytes: 100 }
          }
        })
      },
      { request: 'x'.repeat(10_000) },
      {
        scope: 'single-piece-fallback',
        preflight: Effect.void,
        sources: {
          referenceSchema: Schema.String,
          documents: [
            {
              key: 'one',
              reference: 'exact',
              load: Effect.succeed({
                name: 'Original',
                document: document(['original '.repeat(375)])
              })
            }
          ]
        }
      }
    ).pipe(Effect.map(({ output }) => output));

    assert.equal(await run(databases, execute, Schema.String, prompts), 'Final [1]');
    assert.isAbove(prompts.filter((prompt) => prompt.includes('Map task:')).length, 1);
    assert.include(prompts[0]!, 'Map task:');
    assert.include(prompts.at(-1)!, 'Prepared concept');
  }
);

test.stable(
  'rejects missing captured context at runtime and prevents streaming bypass',
  async ({ databases, expectTypeOf, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const definition = defineAgent({ ...replyAgent, context: preparation });
    const widened: AgentDefinition<typeof replyAgent.input, typeof replyAgent.output> = definition;

    expectTypeOf(definition).not.toExtend<Parameters<typeof generateAgent>[0]>();
    expectTypeOf(widened).not.toExtend<Parameters<typeof generateAgent>[0]>();
    const missing = Reflect.apply(generateAgent, undefined, [definition, { request: 'Learn' }, {}]);
    const result = await Effect.runPromise(Effect.flip(missing));

    assert.instanceOf(result, StudyError);
    assert.equal(result.kind, 'invalid_input');
    const prompts: string[] = [];
    const streamed = streamAgent(definition, { request: 'Learn' }).pipe(
      Stream.runDrain,
      Effect.flip,
      Effect.map((error) => error.kind)
    );

    assert.equal(await run(databases, streamed, Schema.String, prompts), 'unsupported');
    assert.equal(prompts.length, 0);
  }
);

test.stable(
  'reduction groups include prompt escaping and instruction overhead in their budget',
  async ({ databases, createAiMock, assert: assertions }) => {
    const assert: test.Assert = assertions;

    using ai = createAiMock();
    const source = ['a'.repeat(1000), 'b'.repeat(1000)];
    const mapped = source.map((_, index) => ({
      notes: [{ text: '\\'.repeat(20000), markers: [index + 1] }]
    }));
    const compacted = source.map((_, index) => ({
      notes: [{ text: 'Compact concept', markers: [index + 1] }]
    }));
    const reductionPrompt = (values: readonly (typeof notesSchema.Type)[]) =>
      `Reduce task: Learn\nDerived context (never original quotations):\n${JSON.stringify(values)}`;

    for (const [index, text] of source.entries()) {
      ai.next(notesAgent, {
        input: {
          prompt: `Map task: Learn\nOriginal passages (data):\n[${index + 1}] Original\n${text}`
        },
        output: mapped[index]!
      });
    }

    for (const [index, value] of mapped.entries()) {
      ai.next(notesAgent, {
        input: { prompt: reductionPrompt([value]) },
        output: compacted[index]!
      });
    }

    ai.next(notesAgent, {
      input: { prompt: reductionPrompt(compacted) },
      output: { notes: [{ text: 'Combined concept', markers: [1, 2] }] }
    });
    const policy = defineContextPreparation({
      ...preparationDefinition,
      limits: { plan: preparationDefinition.limits.plan }
    });
    const execute = policy
      .prepare('Learn', {
        scope: 'escaped-reduction',
        preflight: Effect.void,
        sources: {
          referenceSchema: Schema.String,
          documents: [
            {
              key: 'one',
              reference: 'original',
              load: Effect.succeed({ name: 'Original', document: document(source) })
            }
          ]
        }
      })
      .pipe(Effect.map((prepared) => prepared.coverage.mode));

    assert.equal(
      await run(databases, execute, Schema.String, [], [], (tier, call) =>
        ai.runtime
          .model(tier, call)
          .pipe(
            Effect.mapError(
              (cause) => new StudyError('internal', 'Unexpected fixture model failure', { cause })
            )
          )
      ),
      'complete'
    );
  }
);
