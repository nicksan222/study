/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks that defineWorkflow preserves the versioned native workflow identity and    │
 * │ its idempotency-key function.                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: workflow retains versioned identity and native schemas.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/definitions/define-workflow directly with node:test; no         │
 * │ application or database fixture is involved.                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';
import { Schema } from 'effect';

import { defineWorkflow } from '#server/platform/definitions/define-workflow';

testStable('workflow retains versioned identity and native schemas', () => {
  const workflow = defineWorkflow({
    name: 'study/test',
    version: 2,
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.String,
    error: Schema.String,
    idempotencyKey: (p) => p.id
  });

  assert.equal(workflow._tag, 'study/test/v2');
  assert.equal(workflow.version, 2);
  assert.equal(workflow.idempotencyKey({ id: 'abc' }), 'abc');
});
