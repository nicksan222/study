import { BunPath } from '@effect/platform-bun';
import { test } from '@study/testing';
import { Effect, Path } from 'effect';

import { localModelFile } from './local-model-file.ts';

test.unit.stable('local voice model requests match Windows and POSIX filenames', ({ expect }) => {
  for (const [layer, directory] of [
    [BunPath.layerWin32, 'C:\\Study models\\'],
    [BunPath.layerPosix, '/tmp/Study models/']
  ] as const) {
    const path = Effect.runSync(Effect.provide(Path.Path, layer));
    const files = [{ name: `${directory}parakeet.gguf` }, { name: `${directory}silero.gguf` }];

    expect(localModelFile(files, 'https://voice.invalid/models/parakeet.gguf', path)).toBe(
      files[0]
    );
    expect(localModelFile(files, 'https://voice.invalid/models/silero.gguf', path)).toBe(files[1]);
    expect(
      localModelFile(files, 'https://voice.invalid/models/other-parakeet.gguf', path)
    ).toBeUndefined();
  }
});
