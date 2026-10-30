import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Schema } from 'effect';

import { defineWorkflow } from '#server/platform/definitions/define-workflow';

test('workflow retains versioned identity and native schemas', () => {
  const workflow = defineWorkflow({
    name: 'study/test',
    version: 2,
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.String,
    error: Schema.String,
    idempotencyKey: (p) => p.id
  });

  assert.equal(workflow._tag, 'study/test/v2');
  assert.equal(workflow.idempotencyKey({ id: 'abc' }), 'abc');
});
