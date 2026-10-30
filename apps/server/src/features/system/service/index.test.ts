import assert from 'node:assert/strict';
import { test } from 'node:test';

import { healthSchema, searchInputSchema } from '@study/contracts/system/rpc';
import { Schema } from 'effect';

import { healthData } from './health.ts';

test('health reports the lifecycle state in the canonical health shape', () => {
  assert.deepEqual(Schema.decodeUnknownSync(healthSchema)(healthData(true)), {
    protocolVersion: 1,
    workersRunning: true,
    testMode: false
  });
  assert.equal(healthData(false).workersRunning, false);
});

test('search input rejects out-of-bounds limits and invalid project IDs', () => {
  const decode = Schema.decodeUnknownSync(searchInputSchema);

  assert.throws(() => decode({ query: 'a', limit: 101 }));
  assert.throws(() => decode({ query: 'a', limit: 0 }));
  assert.throws(() => decode({ query: 'a', project: 0n }));
  assert.equal(decode({ query: '' }).limit, 30);
});
