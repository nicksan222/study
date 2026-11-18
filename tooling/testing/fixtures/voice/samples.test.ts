import { test } from '@study/testing';

import { voiceFilePcm } from './samples';

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
