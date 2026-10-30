import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendRecordingInputSchema,
  recordingPageInputSchema
} from '@study/contracts/recordings/rpc';
import { Schema } from 'effect';

test('recording append accepts only bounded signed 16-bit PCM', () => {
  const decode = Schema.decodeUnknownSync(appendRecordingInputSchema);

  assert.deepEqual(decode({ id: 1n, samples: [-32768, 0, 32767] }).samples, [-32768, 0, 32767]);

  for (const samples of [[], [32768], [-32769], [1.5], [NaN], Array(960001).fill(0)])
    assert.throws(() => decode({ id: 1n, samples }));
});

test('recording pages are bounded', () => {
  const decode = Schema.decodeUnknownSync(recordingPageInputSchema);

  assert.throws(() => decode({ limit: 0 }));
  assert.throws(() => decode({ limit: 101 }));
  assert.equal(decode({ limit: 100 }).limit, 100);
});
