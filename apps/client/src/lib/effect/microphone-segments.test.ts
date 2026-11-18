import { test } from '@study/testing';

import { MicrophoneSegments, microphoneSampleRate } from './microphone-segments';

test.unit.stable('cuts near a pause without dropping or duplicating captured PCM', ({ expect }) => {
  const limit = 10 * microphoneSampleRate;
  const audio = new Float32Array(limit + 240).fill(0.5);
  const silenceStart = limit - 960;
  const silenceEnd = limit - 320;

  audio.fill(0, silenceStart, silenceEnd);
  const segments = new MicrophoneSegments(limit);
  const emitted: Float32Array[] = [];

  for (let offset = 0; offset < audio.length; offset += 128) {
    expect(
      segments.write(audio.subarray(offset, offset + 128), (samples) => {
        emitted.push(samples);

        return true;
      })
    ).toBe(true);
  }

  expect(emitted).toHaveLength(1);
  const chunk = emitted[0]!;

  expect(chunk.length).toBeGreaterThan(silenceStart);
  expect(chunk.length).toBeLessThan(silenceEnd);
  expect(chunk).toEqual(audio.slice(0, chunk.length));
  expect(segments.finish()).toEqual(audio.slice(chunk.length));
});

test.unit.stable(
  'bounds uninterrupted speech and rejects a backlogged second chunk',
  ({ expect }) => {
    const limit = 10 * microphoneSampleRate;
    const segments = new MicrophoneSegments(limit);
    const audio = new Float32Array(3 * limit).fill(0.25);
    const lengths: number[] = [];

    expect(
      segments.write(audio, (chunk) => {
        lengths.push(chunk.length);

        return lengths.length === 1;
      })
    ).toBe(false);
    expect(lengths).toEqual([limit, limit]);
  }
);
