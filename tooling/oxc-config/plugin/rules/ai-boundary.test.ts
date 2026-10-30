import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('ai-boundary rejects forbidden edges', () => {
  const diagnostics = lintRule('ai-boundary', {
    'src/domains/jobs/service.ts': "import { generateText } from 'ai';"
  });

  assert.equal(diagnostics.length, 1);
});

test('platform AI runtime owns generation and respects lexical shadowing', () => {
  const diagnostics = lintRule('ai-boundary', {
    'src/platform/ai/providers/a.ts':
      "import { generateText as generate } from 'ai'; const run = generate; run({}); function f(run: () => void) { run(); }",
    'src/platform/ai/agents.ts': "import { generateText } from 'ai'; generateText({});"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('feature agents and tools use narrow capabilities and only platform AI owns SDK access', () => {
  const diagnostics = lintRule('ai-boundary', {
    'src/features/source/source.agent.ts':
      "import { generateText } from 'ai'; import '@ai-sdk/openai'; import '@study/db'; import './source.store';",
    'src/features/source/source.tool.ts': "import './source.service'; import './source.store';",
    'src/platform/ai/agents.ts': "import { generateText } from 'ai'; generateText({});"
  });

  assert.equal(diagnostics.length, 5, JSON.stringify(diagnostics));
});

test('model work stays in checkpointed workflow activities', () => {
  const diagnostics = lintRule('ai-boundary', {
    'src/features/sources/service.ts':
      "import {generateAgent as generate} from '#server/platform/ai/agents'; const run = generate; run(agent,input);",
    'src/features/sources/workflow.ts':
      "import {Activity} from 'effect/workflow'; import {Effect} from 'effect'; import {generateAgent} from '#server/platform/ai/agents'; generateAgent(agent,input); Activity.make({execute:Effect.gen(function*(){return yield* generateAgent(agent,input,{maxRetries:0,preflight:Effect.void});})});",
    'src/platform/ai/agents.ts': "import {streamText} from 'ai'; streamText({});"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('destructured generation aliases cannot bypass checkpoint ownership', () => {
  const diagnostics = lintRule('ai-boundary', {
    'src/features/sources/service.ts':
      "import * as api from '#server/platform/ai/agents'; const ns = api; const {generateAgent: run} = ns; const alias = run; alias(agent,input); function f(alias) {alias(agent,input);}",
    'src/features/sources/workflow.ts':
      "import * as api from '#server/platform/ai/agents'; const ns = api; ns.streamAgent(agent,input);"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('the agent factory may describe SDK messages but cannot execute SDK generation', () => {
  const diagnostics = lintRule('ai-boundary', {
    'src/platform/definitions/define-agent.ts':
      "import type {ModelMessage} from 'ai'; import {generateText} from 'ai';",
    'src/features/sources/service.ts': "import type {ModelMessage} from 'ai';"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('workflow model calls declare a last-boundary preflight and leave retries to activities', () => {
  const diagnostics = lintRule('ai-boundary', {
    'src/features/source/workflow.ts':
      "import {Effect} from 'effect'; import {Activity} from 'effect/workflow'; import {generateAgent} from '#server/platform/ai/agents'; Activity.make({execute:Effect.gen(function*(){yield* generateAgent(agent,input); yield* generateAgent(agent,input,{maxRetries:1,preflight:Effect.void}); const options={maxRetries:0,preflight:check}; yield* generateAgent(agent,input,options);})});"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});
