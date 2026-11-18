import { BunPath } from '@effect/platform-bun';
import { speechRecognitionStrategies } from '@study/server/testing';
import type { test } from '@study/testing';
import { Effect, Path } from 'effect';

import { voiceFilePcm } from '../fixtures/voice/samples.ts';
import { normalize, pcm16, withVoiceModel } from './model-fixture.ts';

// Issue attachments stay external because the report grants no redistribution license.
// https://github.com/handy-computer/transcribe.cpp/issues/252
function loadRegressionClips(directory: string) {
  const path = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));
  const clips = [
    {
      name: 'clip-5.04s-empty.wav',
      samples: 80_640,
      reference: 'By no possible supposition could this stranger, Fitzroy Simpson, have caused'
    },
    {
      name: 'clip-10.56s-cut-off.wav',
      samples: 168_960,
      reference:
        'His bridle is missing, so that Simpson must have put this on. Then, having left the door open behind him, he was leading the horse away over the moor,'
    }
  ];

  return Promise.all(
    clips.map(async (clip) => ({
      ...clip,
      pcm: await voiceFilePcm(path.join(directory, clip.name))
    }))
  );
}

export async function verifyParakeetFrameBoundary(
  { expect, resources }: Pick<test.server.Context, 'expect' | 'resources'>,
  regressionDirectory: string
) {
  const parakeet = speechRecognitionStrategies.find(({ model }) => model.id === 'parakeet-tdt-v3');

  if (!parakeet) throw new Error('The frame-boundary regression requires registered Parakeet.');

  const clips = await loadRegressionClips(regressionDirectory);

  await withVoiceModel({ resources, expect }, parakeet, (client) =>
    Effect.gen(function* () {
      // Preserve the tested frame count by leaving silence filtering disabled.
      yield* client['settings.saveVoiceSettings']({ filterSilence: false, denoise: false });

      for (const { pcm, ...clip } of clips) {
        expect(pcm.length, clip.name).toBe(clip.samples);

        for (const trim of [0, 1]) {
          const { text } = yield* client['voice.transcribe']({
            samples: pcm16(pcm.subarray(0, pcm.length - trim))
          });

          expect(normalize(text), `${clip.name}, ${trim} samples trimmed`).toEqual(
            normalize(clip.reference)
          );
        }
      }
    })
  );
}
