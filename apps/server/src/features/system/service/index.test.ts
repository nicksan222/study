/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks health response shape and search input schema bounds.                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises health reports the lifecycle state in the canonical health shape.            │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { healthSchema, searchInputSchema } from '@study/contracts/system/rpc';
import { testStable } from '@study/testing/node';
import { Schema } from 'effect';

import { healthData } from './health.ts';

testStable('health reports the lifecycle state in the canonical health shape', () => {
  assert.deepEqual(Schema.decodeUnknownSync(healthSchema)(healthData(true)), {
    protocolVersion: 1,
    workersRunning: true,
    testMode: false
  });
  assert.equal(healthData(false).workersRunning, false);
});

testStable('search input rejects out-of-bounds limits and invalid project IDs', () => {
  const decode = Schema.decodeUnknownSync(searchInputSchema);

  assert.throws(() => decode({ query: 'a', limit: 101 }));
  assert.throws(() => decode({ query: 'a', limit: 0 }));
  assert.throws(() => decode({ query: 'a', project: 0n }));
  assert.equal(decode({ query: '' }).limit, 30);
});
