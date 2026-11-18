/** PCM format shared by the capture graph and its audio rendering thread. */
export const microphoneSampleRate = 16_000;

export type MicrophoneCommand = 'acknowledge' | 'stop';

export type MicrophoneMessage =
  | { type: 'started' }
  | { type: 'chunk'; samples: Float32Array }
  | { type: 'stopped'; samples: Float32Array }
  | { type: 'overrun' };

const pauseWindow = microphoneSampleRate / 50;

const pauseLookback = microphoneSampleRate;

const quietPower = 0.012 ** 2;

function cutAtPause(samples: Float32Array) {
  const earliest = Math.max(0, samples.length - pauseLookback);

  for (let end = samples.length; end - pauseWindow >= earliest; end -= pauseWindow) {
    let power = 0;

    for (let index = end - pauseWindow; index < end; index += 1) power += samples[index]! ** 2;

    if (power / pauseWindow < quietPower) return end - pauseWindow / 2;
  }

  return samples.length;
}

/** Keep the untransmitted tail when cutting near a quiet point. No sample is repeated or skipped. */
export class MicrophoneSegments {
  private readonly buffer: Float32Array;
  private length = 0;

  constructor(framesPerChunk: number) {
    this.buffer = new Float32Array(framesPerChunk);
  }

  write(input: Float32Array, emit: (samples: Float32Array) => boolean) {
    let offset = 0;

    while (offset < input.length) {
      const count = Math.min(input.length - offset, this.buffer.length - this.length);

      this.buffer.set(input.subarray(offset, offset + count), this.length);
      this.length += count;
      offset += count;

      if (this.length === this.buffer.length && !this.emitSegment(emit)) return false;
    }

    return true;
  }

  private emitSegment(emit: (samples: Float32Array) => boolean) {
    const cut = cutAtPause(this.buffer);

    if (!emit(this.buffer.slice(0, cut))) return false;

    this.buffer.copyWithin(0, cut);
    this.length -= cut;

    return true;
  }

  finish() {
    return this.buffer.slice(0, this.length);
  }
}
