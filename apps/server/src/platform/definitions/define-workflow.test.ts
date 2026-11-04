/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks that defineWorkflow preserves the versioned native workflow identity and    │
 * │ its idempotency-key function.                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: workflow retains versioned identity and native schemas.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/definitions/define-workflow directly with Vitest   ; no         │
 * │ application or database fixture is involved.                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert } from 'vite-plus/test';

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

  assert.ok(workflow._tag === 'study/test/v2');
  assert.strictEqual(workflow.version, 2);
  assert.ok(workflow.idempotencyKey({ id: 'abc' }) === 'abc');
});
