import { MAX_DICTATION_SAMPLES } from '@study/contracts';
import { denoisePcm, speechRecognitionStrategies } from '@study/server/testing';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { voiceSamplePcm, voiceSamples } from '../fixtures/voice/samples.ts';
import { normalize, openVoiceModel, pcm16 } from './model-fixture.ts';
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

    return sample + background * rms * 0.45;
  });
}

test.server.stable('RNNoise attenuates room noise before real speech', async ({ expect }) => {
  const speech = await voiceSamplePcm('en_us_0165');
  const noiseLeadIn = 16_000;
  const input = new Float32Array(noiseLeadIn + speech.length);

  input.set(speech, noiseLeadIn);

  const noisy = withRoomNoise(input);
  const filtered = await denoisePcm(noisy);
  // Measure the second half of the lead-in after the filter has adapted.
  const noiseEnergy = (pcm: Float32Array) =>
    pcm.subarray(noiseLeadIn / 2, noiseLeadIn).reduce((sum, sample) => sum + sample ** 2, 0);

  expect(noiseEnergy(filtered) / noiseEnergy(noisy)).toBeLessThanOrEqual(0.75);
});

const recognitionScenarios = [
  { name: 'clean with silence filtering', filterSilence: true, denoise: false, noisy: false },
  { name: 'clean without preprocessing', filterSilence: false, denoise: false, noisy: false },
  { name: 'room noise without preprocessing', filterSilence: false, denoise: false, noisy: true },
  { name: 'room noise with noise reduction', filterSilence: false, denoise: true, noisy: true }
] as const;

type Recording = (typeof voiceSamples)[number];

function expectTranscript(
  expect: test.server.Context['expect'],
  recording: Recording,
  text: string
) {
  const expected = normalize(recording.reference);
  const actual = normalize(text);
  const errors = wordErrors(expected, actual);
  const diagnosis = `Expected “${recording.reference}”, received “${text}” (${errors}/${expected.length} word errors)`;

  expect(actual, diagnosis).not.toHaveLength(0);
  expect(errors, diagnosis).toBeLessThanOrEqual(recording.maximumWordErrors);
}

const regressionDirectory = process.env.STUDY_VOICE_REGRESSION_DIRECTORY;

for (const strategy of speechRecognitionStrategies) {
  const { model } = strategy;

  const check = test.server.stable.extend(
    'recognizer',
    { scope: 'file' },
    async ({ createServerFixture }, { onCleanup }) => {
      const resources = await createServerFixture();

      onCleanup(() => resources.close());

      return openVoiceModel(resources, strategy);
    }
  );

  test.server.describe(model.id, { concurrent: false }, () => {
    const compatible = voiceSamples.filter(({ language }) => model.languages.includes(language));

    check(
      `installs and covers ${compatible.length} of ${voiceSamples.length} recordings`,
      ({ expect, recognizer }) => {
        expect(
          compatible.length,
          `Add a recording in a language supported by ${model.id}`
        ).toBeGreaterThan(0);
        expect(recognizer.initial).toMatchObject({ modelId: model.id, state: 'missing' });
        expect(recognizer.initial.models).toEqual(
          speechRecognitionStrategies.map(({ model }) => model)
        );
        expect(recognizer.installed.state).toBe('ready');
      }
    );

    for (const { name, filterSilence, denoise, noisy } of recognitionScenarios)
      check.for(compatible)(
        `$id ($language) · ${name}`,
        async (recording, { expect, recognizer }) => {
          const { client } = recognizer;
          const pcm = await voiceSamplePcm(recording.id);

          await Effect.runPromise(client['settings.saveVoiceSettings']({ filterSilence, denoise }));
          const { text } = await Effect.runPromise(
            client['voice.transcribe']({ samples: pcm16(noisy ? withRoomNoise(pcm) : pcm) })
          );

          expectTranscript(expect, recording, text);
        }
      );

    check('transcribes a maximum-length segment', async ({ expect, recognizer }) => {
      const recording = compatible[0];

      if (!recording) throw new Error(`No compatible recordings for ${model.id}`);

      const samples = pcm16(await voiceSamplePcm(recording.id));
      const padding = Array<number>(MAX_DICTATION_SAMPLES - samples.length).fill(0);
      const { client } = recognizer;

      await Effect.runPromise(
        client['settings.saveVoiceSettings']({ filterSilence: false, denoise: false })
      );
      const { text } = await Effect.runPromise(
        client['voice.transcribe']({ samples: samples.concat(padding) })
      );

      expectTranscript(expect, recording, text);
    });

    check('filters an all-silence segment', async ({ expect, recognizer }) => {
      const { client } = recognizer;

      await Effect.runPromise(
        client['settings.saveVoiceSettings']({ filterSilence: true, denoise: false })
      );
      expect(
        await Effect.runPromise(client['voice.transcribe']({ samples: Array(32_000).fill(0) }))
      ).toEqual({ text: '' });
    });

    if (model.id === 'parakeet-tdt-v3' && regressionDirectory)
      check('preserves full text at the reported mel-frame boundaries', ({ expect, recognizer }) =>
        verifyParakeetFrameBoundary(expect, recognizer, regressionDirectory)
      );
  });
}
