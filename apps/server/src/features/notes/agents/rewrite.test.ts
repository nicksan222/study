import { test } from '@study/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies rewrite prompts distinguish note targets from captured task               │
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

import { rewriteAgent } from './rewrite.ts';

for (const origin of ['improve', 'summarize'] as const)
  test.stable(
    `rewrite ${origin} keeps the captured target immediately before the task`,
    ({ expect }) => {
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

      expect(prompt.slice(0, -1)).toStrictEqual(messages);
      expect(prompt.at(-2)).toStrictEqual(messages.at(-1));
      expect(prompt.at(-1)).toStrictEqual({ role: 'user', content: `Task: ${origin}. ` });
    }
  );

test.stable(
  'rewrite instruction and preferences appear once in the task, outside captured text',
  ({ expect }) => {
    const messages = [{ role: 'user' as const, content: 'Rewrite this passage' }];
    const prompt = rewriteAgent.prompt({
      messages,
      origin: 'instruction',
      instruction: 'Keep qualifiers',
      preferences: { language: 'italian', detail: 'brief' }
    });

    expect(prompt.slice(0, -1)).toStrictEqual(messages);
    expect(prompt.at(-1)).toStrictEqual({
      role: 'user',
      content:
        'Task: instruction. Keep qualifiers\nPreferences: {"language":"italian","detail":"brief"}'
    });
  }
);
