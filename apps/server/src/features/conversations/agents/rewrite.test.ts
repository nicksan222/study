/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies rewrite prompts distinguish conversation targets from captured task       │
 * │ metadata.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps requested targets immediately before the rewrite task directive.                 │
 * │ - Checks instruction and preference composition through production prompt definitions.   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Calls the production agent prompt without a provider or an execution substitute.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rewriteAgent } from './rewrite.ts';

for (const origin of ['improve', 'summarize'] as const)
  test(`rewrite ${origin} keeps the captured target immediately before the task`, () => {
    const messages = [
      { role: 'user' as const, content: 'Earlier context' },
      { role: 'assistant' as const, content: 'The requested target' }
    ];
    const prompt = rewriteAgent.prompt({
      messages,
      origin,
      instruction: null,
      preferences: {}
    });

    assert.deepEqual(prompt.slice(0, -1), messages);
    assert.deepEqual(prompt.at(-2), messages.at(-1));
    assert.deepEqual(prompt.at(-1), { role: 'user', content: `Task: ${origin}. ` });
  });

test('rewrite instruction and preferences appear once in the task, outside captured text', () => {
  const messages = [{ role: 'user' as const, content: 'Rewrite this passage' }];
  const prompt = rewriteAgent.prompt({
    messages,
    origin: 'instruction',
    instruction: 'Keep qualifiers',
    preferences: { language: 'italian', detail: 'brief' }
  });

  assert.deepEqual(prompt.slice(0, -1), messages);
  assert.deepEqual(prompt.at(-1), {
    role: 'user',
    content:
      'Task: instruction. Keep qualifiers\nPreferences: {"language":"italian","detail":"brief"}'
  });
});
