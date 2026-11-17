/** @file Pins the only multilingual dictation model and optional silence detector. */
import type { SpeechAsset } from '@study/server';

function asset(
  repo: string,
  revision: string,
  filename: string,
  size: number,
  sha256: string
): SpeechAsset {
  return {
    filename,
    url: `https://huggingface.co/${repo}/resolve/${revision}/${filename}`,
    size,
    sha256
  };
}

// Pinned from T3 Code's 439c965 catalog; v3 supports Italian and English automatically.
export const speechAssets = [
  asset(
    'handy-computer/parakeet-tdt-0.6b-v3-gguf',
    '85ac09ea12fc4b1112fa76810059364bc6adc9de',
    'parakeet-tdt-0.6b-v3-Q8_0.gguf',
    739_508_576,
    '5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7'
  ),
  asset(
    'handy-computer/silero-vad-v6.2-gguf',
    '97bbd75179f535e4708bccdf61e9278b8b60dfc7',
    'silero-vad-v6.2-F32.gguf',
    1_241_056,
    '0d871a800c420fdd5d1b17a3aea4296d1c39608f0ff4a9295eb76457eb1c88e6'
  )
] as const;
