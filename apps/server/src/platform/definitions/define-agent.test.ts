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

import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { defineAgent } from '#server/platform/definitions/define-agent';

testStable('defineAgent preserves schemas and rejects invalid identifiers', () => {
  const input = Schema.Struct({ prompt: Schema.String });
  const definition = defineAgent({
    id: 'reply',
    input,
    output: Schema.String,
    model: 'tiny',
    instructions: 'Reply',
    prompt: ({ prompt }) => prompt
  });

  assert.strictEqual(definition.input, input);
  assert.throws(() => defineAgent({ ...definition, id: '' }), RangeError);
});
