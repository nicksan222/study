/** @file Fixes today's multilingual Parakeet strategy behind the speech recognition seam. */
import type { SpeechAsset, VoiceRuntimeAdapters } from '@study/server';
import { transcribeInProcess } from '@study/server';

import { speechAssets } from './assets.ts';

interface RecognitionInput {
  readonly samples: readonly number[];
  readonly directory: string;
  readonly filterSilence: boolean;
  readonly denoise: boolean;
}

interface SpeechRecognitionStrategy {
  readonly id: string;
  readonly assets: readonly SpeechAsset[];
  readonly language: { readonly detection: 'automatic'; readonly supported: readonly string[] };
  readonly recognize: (input: RecognitionInput, signal: AbortSignal) => Promise<{ text: string }>;
}

/** Adding an engine changes this composition seam, never a dictation consumer. */
export function createSpeechRecognitionStrategy(
  runtime: VoiceRuntimeAdapters
): SpeechRecognitionStrategy {
  const assets = runtime.assets ?? speechAssets;

  return {
    id: 'parakeet-tdt-v3',
    assets,
    language: {
      detection: 'automatic',
      supported: [
        'bg',
        'hr',
        'cs',
        'da',
        'nl',
        'en',
        'et',
        'fi',
        'fr',
        'de',
        'el',
        'hu',
        'it',
        'lv',
        'lt',
        'mt',
        'pl',
        'pt',
        'ro',
        'ru',
        'sk',
        'sl',
        'es',
        'sv',
        'uk'
      ]
    },
    recognize: (input, signal) =>
      (runtime.transcribe ?? transcribeInProcess)(
        {
          samples: input.samples,
          modelPath: `${input.directory}/ready/${assets[0]!.filename}`,
          vadPath: `${input.directory}/ready/${assets[1]!.filename}`,
          filterSilence: input.filterSilence,
          denoise: input.denoise
        },
        signal
      )
  };
}
