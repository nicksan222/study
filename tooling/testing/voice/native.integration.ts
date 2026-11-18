import { BunPath } from '@effect/platform-bun';
import { StudyRpc } from '@study/contracts';
import { makeStudyClient } from '@study/server/client';
import { transcribeNative } from '@study/server/testing';
import { test } from '@study/testing';
import { Effect, Path } from 'effect';

import { voiceFilePcm, voiceSamplePcm, voiceSamples } from '../fixtures/voice/samples.ts';
import { localModelFile } from './local-model-file.ts';

const path = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

function normalize(text: string) {
  return text
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}' ]/gu, '')
    .trim()
    .split(/\s+/);
}

function wordErrors(expected: string[], actual: string[]) {
  let row = Array.from({ length: actual.length + 1 }, (_, index) => index);

  for (let left = 0; left < expected.length; left++) {
    const next = [left + 1];

    for (let right = 0; right < actual.length; right++)
      next.push(
        Math.min(
          next[right]! + 1,
          row[right + 1]! + 1,
          row[right]! + Number(expected[left] !== actual[right])
        )
      );

    row = next;
  }

  return row[actual.length]!;
}

/** Repeatable low-frequency room hum with a small broadband component. */
function withRoomNoise(pcm: Float32Array) {
  const rms = Math.sqrt(pcm.reduce((sum, sample) => sum + sample * sample, 0) / pcm.length);
  let seed = 12345;
  let previous = 0;

  return Float32Array.from(pcm, (sample, index) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    previous = 0.6 * previous + 0.4 * ((seed / 4294967296) * 2 - 1);

    const background =
      0.6 * Math.sin((index * Math.PI) / 100) +
      0.3 * Math.sin((index * Math.PI) / 60) +
      0.5 * previous;

    return sample + background * rms * 0.2;
  });
}

const recognitionScenarios = [
  { filterSilence: true, denoise: false, noisy: false },
  { filterSilence: false, denoise: false, noisy: false },
  { filterSilence: false, denoise: false, noisy: true },
  { filterSilence: false, denoise: true, noisy: true }
] as const;

const model = process.env.STUDY_VOICE_MODEL;

const vad = process.env.STUDY_VOICE_VAD;

if (!model || !vad)
  throw new Error(
    'Set STUDY_VOICE_MODEL and STUDY_VOICE_VAD to installed pinned GGUF files; this test never downloads models.'
  );

for (const sample of voiceSamples)
  test.server.stable(
    `Native Parakeet TDT v3 recognizes human ${sample.language} speech with and without silence filtering`,
    async ({ expect }) => {
      const pcm = await voiceSamplePcm(sample.id);

      for (const filterSilence of [false, true]) {
        const transcript = transcribeNative(model, vad, pcm, filterSilence);

        expect(transcript.trim()).not.toBe('');
        expect(
          wordErrors(normalize(sample.reference), normalize(transcript)),
          `${sample.id}, silence filter ${filterSilence}: ${transcript}`
        ).toBeLessThanOrEqual(sample.maximumWordErrors);
      }
    }
  );

test.server.stable(
  'Native Parakeet TDT v3 returns no invented speech when Silero filters silence',
  async ({ expect }) => {
    expect(transcribeNative(model, vad, new Float32Array(32_000), true)).toBe('');
  }
);

/** Local fixture delivery replaces the download transport only; RPC, service and child inference are production. */
test.server.stable(
  'Real voice RPC installs Parakeet TDT v3 and recognizes multilingual human recordings',
  async ({ resources, expect }) => {
    const files = [Bun.file(model), Bun.file(vad)];
    const { server } = await resources.openRpc({
      voice: {
        fetch: async (url) => {
          const file = localModelFile(files, url, path);

          if (!file) throw new Error(`Unexpected speech fixture request: ${url}`);

          return new Response(file);
        }
      }
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

          expect((yield* client['voice.status']({})).state).toBe('missing');
          yield* client['voice.install']({});
          expect(yield* client['voice.status']({})).toMatchObject({
            state: 'ready',
            modelId: 'parakeet-tdt-v3',
            languageDetection: 'automatic',
            languages: expect.arrayContaining(voiceSamples.map((sample) => sample.language))
          });

          for (const { filterSilence, denoise, noisy } of recognitionScenarios) {
            yield* client['settings.saveVoiceSettings']({ filterSilence, denoise });

            for (const sample of voiceSamples) {
              const pcm = yield* Effect.promise(() => voiceSamplePcm(sample.id));
              const samples = Array.from(noisy ? withRoomNoise(pcm) : pcm, (value) =>
                Math.max(-32768, Math.min(32767, Math.round(value * 32768)))
              );
              const result = yield* client['voice.transcribe']({ samples });

              console.info(
                JSON.stringify({
                  language: sample.language,
                  filterSilence,
                  denoise,
                  noisy,
                  reference: sample.reference,
                  transcript: result.text
                })
              );

              expect(
                wordErrors(normalize(sample.reference), normalize(result.text)),
                `${sample.id}, silence filter ${filterSilence}, denoise ${denoise}, noise ${noisy}: ${result.text}`
              ).toBeLessThanOrEqual(sample.maximumWordErrors);
            }
          }

          yield* client['settings.saveVoiceSettings']({ filterSilence: true });
          expect(yield* client['voice.transcribe']({ samples: Array(32000).fill(0) })).toEqual({
            text: ''
          });
          yield* client['voice.remove']({});
          expect((yield* client['voice.status']({})).state).toBe('missing');
        })
      )
    );
  }
);

// Issue attachments stay external because the report grants no redistribution license.
// https://github.com/handy-computer/transcribe.cpp/issues/252
const regressionDirectory = process.env.STUDY_VOICE_REGRESSION_DIRECTORY;

if (regressionDirectory) {
  for (const clip of [
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
  ])
    test.server.stable(
      `Native Parakeet preserves full text at the reported ${clip.name} mel-frame boundary`,
      async ({ expect }) => {
        const pcm = await voiceFilePcm(`${regressionDirectory}/${clip.name}`);

        expect(pcm.length).toBe(clip.samples);

        // Keep VAD disabled: changing the length before inference can hide this regression.
        for (const trim of [0, 1]) {
          const transcript = transcribeNative(model, vad, pcm.slice(0, pcm.length - trim), false);

          expect(normalize(transcript)).toEqual(normalize(clip.reference));
        }
      }
    );
}
