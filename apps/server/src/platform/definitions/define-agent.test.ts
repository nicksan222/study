/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks that defineAgent retains its input schema and rejects invalid agent         │
 * │ identifiers. This covers the declaration boundary used by feature-owned agents.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: defineAgent preserves schemas and rejects invalid identifiers.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/definitions/define-agent directly with node:test; no            │
 * │ application or database fixture is involved.                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';
import { Schema } from 'effect';

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

  assert.equal(definition.input, input);
  assert.throws(() => defineAgent({ ...definition, id: '' }), RangeError);
});
