/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks that defineAgent retains its input schema and rejects invalid agent         │
 * │ identifiers. This covers the declaration boundary used by feature-owned agents.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: defineAgent preserves schemas and rejects invalid identifiers.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/definitions/define-agent directly with Vitest   ; no            │
 * │ application or database fixture is involved.                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { AgentRule } from '@study/contracts/settings/schemas';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { defineAgent, defineTool } from '#server/platform/definitions/define-agent';

testStable('defineAgent preserves schemas and rejects invalid identifiers', () => {
  const input = Schema.Struct({ prompt: Schema.String });
  const definition = defineAgent({
    id: 'reply',
    customRules: [AgentRule.Replies],
    input,
    output: Schema.String,
    model: 'tiny',
    instructions: 'Reply',
    prompt: ({ prompt }) => prompt
  });

  assert.strictEqual(definition.input, input);
  assert.throws(() => defineAgent({ ...definition, id: '' }), RangeError);
});

testStable('agent declarations require a nonempty selection of known user rules', () => {
  const valid = {
    id: 'test',
    input: Schema.String,
    output: Schema.String,
    model: 'tiny' as const,
    instructions: 'Test',
    prompt: (input: string) => input
  };

  // @ts-expect-error every declaration must select user rules
  defineAgent(valid);
  // @ts-expect-error empty selections cannot silently bypass user preferences
  defineAgent({ ...valid, customRules: [] });
  // @ts-expect-error raw strings cannot stand in for typed rule selections
  defineAgent({ ...valid, customRules: ['replies'] });

  assert.deepEqual(
    defineAgent({ ...valid, customRules: [AgentRule.Quizzes, AgentRule.Titles] }).customRules,
    [AgentRule.Quizzes, AgentRule.Titles]
  );
});

testStable('tool declarations require a wiki and bind execution to canonical schemas', () => {
  const valid = {
    description: 'Read a count',
    input: Schema.Struct({ count: Schema.Int }),
    output: Schema.Int,
    mutates: false,
    execute: ({ count }: { count: number }) => Effect.succeed(count)
  };
  const wiki = {
    when: 'Read a count',
    examples: ['Read my count'] as const,
    limits: 'Only counts'
  };

  // @ts-expect-error tools cannot omit their capability guide
  defineTool(valid);
  // @ts-expect-error examples must contain at least one usage example
  defineTool({ ...valid, wiki: { ...wiki, examples: [] } });
  // @ts-expect-error execution results must match the output schema
  defineTool({ ...valid, wiki, execute: () => Effect.succeed('wrong') });
  // @ts-expect-error decoded inputs cannot become arbitrary string arguments
  defineTool({ ...valid, wiki, execute: (_input: string) => Effect.succeed(1) });
  // @ts-expect-error provider tools require object-shaped inputs
  defineTool({ ...valid, wiki, input: Schema.String });

  const tool = defineTool({ ...valid, wiki });

  assert.strictEqual(tool.input, valid.input);
});
