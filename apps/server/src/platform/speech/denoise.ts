/** @file Runs bundled RNNoise on bounded mono PCM inside the isolated speech worker. */
import type initialize from '@echogarden/rnnoise-wasm';
import { StudyError } from '@study/contracts';

type Model = Awaited<ReturnType<typeof initialize>>;

const samplesPerFrame = 160;

const sampleRateRatio = 3;

const frameSize = samplesPerFrame * sampleRateRatio;

const pcmScale = 32768;

async function loadModel() {
  const source = import.meta.resolve('@echogarden/rnnoise-wasm');
  const { default: initializeModel } = await import('@echogarden/rnnoise-wasm');
  const wasmBinary = await Bun.file(new URL('rnnoise.wasm', source)).arrayBuffer();
  const model = await initializeModel({ wasmBinary });

  if (model._rnnoise_get_frame_size() !== frameSize)
    throw new StudyError('model_unavailable', 'Unexpected RNNoise frame size');

  return model;
}

/** 16 kHz normalized PCM in and out. RNNoise expects 48 kHz PCM16-scale floats. */
export async function denoisePcm(input: Float32Array): Promise<Float32Array> {
  const model = await loadModel();
  const state = model._rnnoise_create(0);
  const pointer = model._malloc(frameSize * Float32Array.BYTES_PER_ELEMENT);

  try {
    if (!state || !pointer)
      throw new StudyError('model_unavailable', 'Could not allocate RNNoise state');

    return processFrames(model, state, pointer, input);
  } finally {
    if (pointer) model._free(pointer);

    if (state) model._rnnoise_destroy(state);
  }
}

function processFrames(model: Model, state: number, pointer: number, input: Float32Array) {
  const output = new Float32Array(input.length);
  const index = pointer / Float32Array.BYTES_PER_ELEMENT;
  const paddedLength = Math.ceil(input.length / samplesPerFrame) * samplesPerFrame;
  let previous = 0;

  // The overlap-add stage delays output by one frame. Zero-pad the tail and flush once.
  for (let offset = 0; offset <= paddedLength; offset += samplesPerFrame) {
    upsample(model.HEAPF32.subarray(index, index + frameSize), input, offset);
    model._rnnoise_process_frame(state, pointer, pointer);

    const frame = model.HEAPF32.subarray(index, index + frameSize);

    if (offset > 0) downsample(output, offset - samplesPerFrame, frame, previous);

    previous = frame[frameSize - 1]!;
  }

  return output;
}

function upsample(frame: Float32Array, input: Float32Array, offset: number) {
  for (let sample = 0; sample < samplesPerFrame; sample++) {
    const current = (input[offset + sample] ?? 0) * pcmScale;
    const next = (input[offset + sample + 1] ?? 0) * pcmScale;
    const delta = (next - current) / sampleRateRatio;
    const target = sample * sampleRateRatio;

    frame[target] = current;
    frame[target + 1] = current + delta;
    frame[target + 2] = current + 2 * delta;
  }
}

function downsample(output: Float32Array, offset: number, frame: Float32Array, previous: number) {
  const count = Math.min(samplesPerFrame, output.length - offset);

  for (let sample = 0; sample < count; sample++) {
    const index = sample * sampleRateRatio;
    const left = frame[index - 1] ?? previous;
    // Low-pass before decimation to suppress the high-frequency images.
    const filtered = (left + 2 * frame[index]! + frame[index + 1]!) / (4 * pcmScale);

    output[offset + sample] = Math.max(-1, Math.min(1, filtered));
  }
}
