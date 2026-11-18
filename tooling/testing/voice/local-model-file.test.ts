import { BunPath } from '@effect/platform-bun';
import { test } from '@study/testing';
import { Effect, Path } from 'effect';

import { localModelPaths } from './local-model-file.ts';

const model = {
  id: 'speech-model',
  assets: [
    { filename: 'speech.gguf', url: 'https://voice.invalid/pinned/revision/speech.gguf' },
    { filename: 'vad.gguf', url: 'https://voice.invalid/another/revision/vad.gguf' }
  ]
};

test.unit.stable('native voice fixtures use registered assets and portable paths', ({ expect }) => {
  for (const [layer, directory, separator] of [
    [BunPath.layerWin32, 'C:\\Study models', '\\'],
    [BunPath.layerPosix, '/tmp/Study models', '/']
  ] as const) {
    const path = Effect.runSync(Effect.provide(Path.Path, layer));
    const prefix = [directory, model.id, 'ready'].join(separator);

    for (const asset of model.assets)
      expect(localModelPaths(model, asset.url, directory, path)).toEqual([
        [prefix, asset.filename].join(separator),
        [directory, asset.filename].join(separator)
      ]);

    expect(
      localModelPaths(model, 'https://voice.invalid/unpinned/speech.gguf', directory, path)
    ).toBeUndefined();
  }
});
