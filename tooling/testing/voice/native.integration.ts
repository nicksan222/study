import { StudyRpc } from '@study/contracts';
import { makeStudyClient } from '@study/server/client';
import { transcribeNative } from '@study/server/testing';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { voiceFilePcm, voiceSamplePcm, voiceSamples } from '../fixtures/voice/samples.ts';

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

const model = process.env.STUDY_VOICE_MODEL;

const vad = process.env.STUDY_VOICE_VAD;

if (!model || !vad)
  throw new Error(
    'Set STUDY_VOICE_MODEL and STUDY_VOICE_VAD to installed pinned GGUF files; this test never downloads models.'
  );

for (const sample of voiceSamples)
  test.server.stable(
    `Native dictation recognizes human ${sample.language} speech with and without silence filtering`,
    async ({ expect }) => {
      const pcm = await voiceSamplePcm(sample.id);

      for (const filterSilence of [false, true]) {
        const transcript = transcribeNative(model, vad, pcm, filterSilence);

        expect(transcript.trim()).not.toBe('');
        expect(wordErrors(normalize(sample.reference), normalize(transcript))).toBeLessThanOrEqual(
          sample.maximumWordErrors
        );
      }
    }
  );

test.server.stable(
  'Native silence filtering returns no invented speech for silence',
  async ({ expect }) => {
    expect(transcribeNative(model, vad, new Float32Array(32_000), true)).toBe('');
  }
);

/** Local fixture delivery replaces the download transport only; RPC, service and child inference are production. */
test.server.stable(
  'Real voice RPC installs verified models and recognizes multilingual human recordings',
  async ({ resources, expect }) => {
    const files = [Bun.file(model), Bun.file(vad)];
    const { server } = await resources.openRpc({
      voice: {
        fetch: async (url) => {
          const file = files.find((candidate) =>
            new URL(url).pathname.endsWith('/' + candidate.name!.split('/').at(-1))
          );

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
          expect((yield* client['voice.status']({})).state).toBe('ready');

          for (const filterSilence of [true, false]) {
            yield* client['settings.saveVoiceSettings']({ filterSilence });

            for (const sample of voiceSamples) {
              const pcm = yield* Effect.promise(() => voiceSamplePcm(sample.id));
              const samples = Array.from(pcm, (value) =>
                Math.max(-32768, Math.min(32767, Math.round(value * 32768)))
              );
              const result = yield* client['voice.transcribe']({ samples });

              console.info(
                JSON.stringify({
                  language: sample.language,
                  filterSilence,
                  reference: sample.reference,
                  transcript: result.text
                })
              );

              expect(
                wordErrors(normalize(sample.reference), normalize(result.text))
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
