import { test } from '@study/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks WAV encoding headers, PCM payload preservation, and invalid or oversized    │
 * │ recording rejection.                                                                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises encodes signed PCM samples as 16 kHz mono 16-bit WAV.                        │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { encodeRecordingWav } from './audio.ts';

test.stable(
  'encodes signed PCM samples as 16 kHz mono 16-bit WAV',
  ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const wav = encodeRecordingWav([new Uint8Array([0, 128, 255, 127])]);

    assert.ok(Buffer.from(wav.subarray(0, 4)).toString() === 'RIFF');
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    assert.strictEqual(view.getUint32(4, true), 40);
    assert.strictEqual(view.getUint16(20, true), 1);
    assert.strictEqual(view.getUint16(22, true), 1);
    assert.strictEqual(view.getUint32(24, true), 16000);
    assert.strictEqual(view.getUint32(28, true), 32000);
    assert.strictEqual(view.getUint16(32, true), 2);
    assert.strictEqual(view.getUint16(34, true), 16);
    assert.strictEqual(view.getUint32(40, true), 4);
    expect([...wav.subarray(44)]).toStrictEqual([0, 128, 255, 127]);
  }
);

test.stable('rejects empty, malformed and over-one-hour PCM', ({ assert: assertions }) => {
  const assert: test.Assert = assertions;

  assert.throws(() => encodeRecordingWav([]));
  assert.throws(() => encodeRecordingWav([new Uint8Array(1)]));
  assert.throws(() => encodeRecordingWav([new Uint8Array(16000 * 60 * 60 * 2 + 2)]));
});
