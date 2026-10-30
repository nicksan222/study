import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeRecordingWav } from './audio.ts';

test('encodes signed PCM samples as 16 kHz mono 16-bit WAV', () => {
  const wav = encodeRecordingWav([new Uint8Array([0, 128, 255, 127])]);

  assert.equal(Buffer.from(wav.subarray(0, 4)).toString(), 'RIFF');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  assert.equal(view.getUint32(4, true), 40);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 4);
  assert.deepEqual([...wav.subarray(44)], [0, 128, 255, 127]);
});

test('rejects empty, malformed and over-one-hour PCM', () => {
  assert.throws(() => encodeRecordingWav([]));
  assert.throws(() => encodeRecordingWav([new Uint8Array(1)]));
  assert.throws(() => encodeRecordingWav([new Uint8Array(16000 * 60 * 60 * 2 + 2)]));
});
