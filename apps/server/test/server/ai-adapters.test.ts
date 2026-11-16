import { AgentRule } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises shared typed mocks through the real application's AI dependencies.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps schema decoding, SDK streaming and tool validation active around mocked results. │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Test fixtures own mock expectations; production services own runtime and SQLite state.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { Agents, generateAgent } from '#server/platform/ai/agents';
import { adaptTool } from '#server/platform/ai/tool-adapter';
import { defineAgent, defineTool } from '#server/platform/definitions/define-agent';

const agent = defineAgent({
  id: 'testing-summary',
  input: Schema.Struct({ topic: Schema.String, revision: Schema.BigIntFromString }),
  output: Schema.Struct({ summary: Schema.String, revision: Schema.BigIntFromString }),
  model: 'tiny',
  mode: 'object',
  customRules: [AgentRule.Replies],
  instructions: 'Summarize the supplied topic.',
  prompt: ({ topic }) => topic
});

test.stable(
  'shared one-shot mocks use the real application agent and tool adapters',
  async ({ resources: resourcesFixture }) => {
    const resources = resourcesFixture;
    using mock = test.createAiMock();
    const input = { topic: 'Cell division', revision: 2n };
    const output = { summary: 'Mitosis preserves the chromosome count.', revision: 2n };
    let actualExecutions = 0;
    const tool = defineTool({
      description: 'Read a captured observation',
      wiki: {
        when: 'Read observations.',
        examples: ['Read observation one.'],
        limits: 'Captured only.'
      },
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ text: Schema.String }),
      mutates: false,
      execute: () => {
        actualExecutions++;

        return Effect.succeed({ text: 'Actual execution must remain unused.' });
      }
    });

    const nextAgent = mock.next(agent, { input, output });
    const nextTool = mock.next(tool, {
      input: { id: 'observation-one' },
      output: { text: 'Original observation' }
    });
    const app = await resources.openApp({
      ai: mock.runtime,
      fetch: async () => {
        throw new Error('Mocked model work must not use external HTTP');
      }
    });

    test.expect(await app.nativeRuntime.runPromise(generateAgent(agent, input))).toEqual(output);
    test.expect((await nextAgent.called).input).toEqual(input);
    const toolOutput = await app.nativeRuntime.runPromise(
      Effect.gen(function* () {
        const environment = yield* Agents;
        const span = yield* Effect.currentSpan;
        const context = yield* Effect.context<never>();
        const adapter = adaptTool(tool, environment, span, {}, context);

        return yield* Effect.promise(async () =>
          adapter.execute!(
            { id: 'observation-one' },
            {
              toolCallId: 'read-observation',
              messages: [],
              abortSignal: new AbortController().signal
            }
          )
        );
      }).pipe(Effect.withSpan('testing.mocked-tool'))
    );

    test.expect(toolOutput).toEqual({ text: 'Original observation' });
    test.expect((await nextTool.called).input).toEqual({ id: 'observation-one' });
    test.expect(actualExecutions).toBe(0);
  }
);
