import { speechRecognitionStrategies } from '@study/server/testing';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { voiceSamplePcm, voiceSamples } from '../fixtures/voice/samples.ts';
import { normalize, pcm16, withVoiceModel } from './model-fixture.ts';
import { verifyParakeetFrameBoundary } from './parakeet-regression.ts';

function wordErrors(expected: string[], actual: string[]) {
  let row = Array.from({ length: actual.length + 1 }, (_, index) => index);

  for (let left = 0; left < expected.length; left++) {
    const next = [left + 1];

    for (let right = 0; right < actual.length; right++) {
      next.push(
        Math.min(
          next[right]! + 1,
          row[right + 1]! + 1,
          row[right]! + Number(expected[left] !== actual[right])
        )
      );
    }

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
  { name: 'clean with silence filtering', filterSilence: true, denoise: false, noisy: false },
  { name: 'clean without preprocessing', filterSilence: false, denoise: false, noisy: false },
  { name: 'room noise without preprocessing', filterSilence: false, denoise: false, noisy: true },
  { name: 'room noise with noise reduction', filterSilence: false, denoise: true, noisy: true }
] as const;

async function prepareRecordings(recordings: readonly (typeof voiceSamples)[number][]) {
  return Promise.all(
    recordings.map(async (sample) => {
      const pcm = await voiceSamplePcm(sample.id);

      return {
        ...sample,
        expected: normalize(sample.reference),
        clean: pcm16(pcm),
        noisy: pcm16(withRoomNoise(pcm))
      };
    })
  );
}

for (const strategy of speechRecognitionStrategies)
  test.server.stable(
    `Real voice RPC exercises the shared dictation cases for ${strategy.model.id}`,
    async ({ resources, expect }) => {
      const supported = new Set<string>(strategy.model.languages);
      const compatible = voiceSamples.filter((sample) => supported.has(sample.language));
      const recordings = await prepareRecordings(compatible);

      expect(recordings.length, `Add a shared recording for ${strategy.model.id}`).toBeGreaterThan(
        0
      );
      await withVoiceModel({ resources, expect }, strategy, (client) =>
        Effect.gen(function* () {
          for (const { name, filterSilence, denoise, noisy } of recognitionScenarios) {
            yield* client['settings.saveVoiceSettings']({ filterSilence, denoise });

            for (const recording of recordings) {
              const result = yield* client['voice.transcribe']({
                samples: noisy ? recording.noisy : recording.clean
              });
              const transcript = normalize(result.text);
              const diagnosis = `${strategy.model.id}, ${recording.id}, ${name}: ${result.text}`;

              expect(transcript.length, diagnosis).toBeGreaterThan(0);
              expect(wordErrors(recording.expected, transcript), diagnosis).toBeLessThanOrEqual(
                recording.maximumWordErrors
              );
            }
          }

          yield* client['settings.saveVoiceSettings']({ filterSilence: true, denoise: false });
          expect(yield* client['voice.transcribe']({ samples: Array(32_000).fill(0) })).toEqual({
            text: ''
          });
        })
      );
    }
  );

const regressionDirectory = process.env.STUDY_VOICE_REGRESSION_DIRECTORY;

if (regressionDirectory)
  test.server.stable(
    'Native Parakeet preserves full text at the reported mel-frame boundaries',
    async ({ expect, resources }) =>
      verifyParakeetFrameBoundary({ expect, resources }, regressionDirectory)
  );
