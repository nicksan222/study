import { healthSchema, searchInputSchema } from '@study/contracts';
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
import { test } from '@study/testing';
import { Schema } from 'effect';

import { healthData } from './health.ts';

test.server.stable(
  'health reports the lifecycle state in the canonical health shape',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(Schema.decodeUnknownSync(healthSchema)(healthData(true))).toStrictEqual({
      protocolVersion: 1,
      workersRunning: true,
      testMode: false
    });
    assert.ok(healthData(false).workersRunning === false);
  }
);

test.server.stable(
  'search input rejects out-of-bounds limits and invalid project IDs',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const decode = Schema.decodeUnknownSync(searchInputSchema);

    assert.throws(() => decode({ query: 'a', limit: 101 }));
    assert.throws(() => decode({ query: 'a', limit: 0 }));
    assert.throws(() => decode({ query: 'a', project: 0n }));
    assert.strictEqual(decode({ query: '' }).limit, 30);
  }
);
