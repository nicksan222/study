import { appendRecordingInputSchema, recordingPageInputSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks schema bounds for appended PCM samples and recording pagination.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises recording append accepts only bounded signed 16-bit PCM.                     │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Schema } from 'effect';

test.stable(
  'recording append accepts only bounded signed 16-bit PCM',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const decode = Schema.decodeUnknownSync(appendRecordingInputSchema);

    expect(decode({ id: 1n, samples: [-32768, 0, 32767] }).samples).toStrictEqual([
      -32768, 0, 32767
    ]);

    for (const samples of [[], [32768], [-32769], [1.5], [NaN], Array(960001).fill(0)])
      assert.throws(() => decode({ id: 1n, samples }));
  }
);

test.stable('recording pages are bounded', ({ assert: assertions }) => {
  const assert: test.Assert = assertions;

  const decode = Schema.decodeUnknownSync(recordingPageInputSchema);

  assert.throws(() => decode({ limit: 0 }));
  assert.throws(() => decode({ limit: 101 }));
  assert.strictEqual(decode({ limit: 100 }).limit, 100);
});
