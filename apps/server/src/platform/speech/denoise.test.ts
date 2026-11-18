import { test } from '@study/testing';

import { denoisePcm } from './denoise.ts';

test.server.stable(
  'RNNoise attenuates background noise and keeps the original PCM length',
  async ({ expect }) => {
    let seed = 12345;
    const input = Float32Array.from({ length: 16001 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

      return ((seed / 4294967296) * 2 - 1) * 0.04;
    });
    const original = input.slice();
    const output = await denoisePcm(input);

    expect(output).toHaveLength(original.length);
    expect(input).toEqual(original);
    expect(output.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1)).toBe(true);
    expect(energy(output)).toBeLessThan(energy(original) * 0.25);
  }
);

function energy(samples: Float32Array) {
  return samples.reduce((total, sample) => total + sample * sample, 0);
}
