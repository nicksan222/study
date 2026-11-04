import assert from 'node:assert/strict';

/** Migration assertions require the row itself before inspecting its retained fields. */
export function requireRow<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, 'Expected retained fixture row');
  return value;
}
