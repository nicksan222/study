import { test } from '@study/testing';

import { voiceFilePcm, voiceSamples } from './samples';

test.unit.stable(
  'rejects a truncated WAV format chunk before reading its declared fields',
  async ({ expect, temporaryDirectory }) => {
    await using directory = await temporaryDirectory();
    const path = `${directory.path}/short-format.wav`;
    const bytes = new TextEncoder().encode('RIFF0000WAVEfmt \0\0\0\0');

    await Bun.write(path, bytes);

    await expect(voiceFilePcm(path)).rejects.toThrow('Unsupported WAV fixture format');
  }
);

test.unit.stable('the recognition corpus contains ten distinct human recordings', ({ expect }) => {
  expect(new Set(voiceSamples.map(({ id }) => id)).size).toBe(10);
});
