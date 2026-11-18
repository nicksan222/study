import { MicrophoneSegments } from './microphone-segments';
import type { MicrophoneCommand, MicrophoneMessage } from './microphone-segments';

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][]): boolean;
}

type ProcessorOptions = { processorOptions: { framesPerChunk: number } };

declare function registerProcessor(
  name: string,
  processor: new (options: ProcessorOptions) => AudioWorkletProcessor
): void;

/** Captures mono frames on the audio rendering thread so main-thread delays cannot grow the buffer. */
export default class MicrophoneProcessor extends AudioWorkletProcessor {
  private readonly segments: MicrophoneSegments;
  private awaitingAcknowledgement = false;
  private running = true;
  private started = false;

  constructor(options: ProcessorOptions) {
    super();
    this.segments = new MicrophoneSegments(options.processorOptions.framesPerChunk);
    this.port.onmessage = ({ data }: MessageEvent<MicrophoneCommand>) => {
      if (data === 'acknowledge') this.awaitingAcknowledgement = false;

      if (data === 'stop' && this.running) {
        this.running = false;
        this.send({ type: 'stopped', samples: this.segments.finish() });
      }
    };
  }

  private send(message: MicrophoneMessage) {
    this.port.postMessage(message, 'samples' in message ? [message.samples.buffer] : []);
  }

  private emit(samples: Float32Array) {
    if (this.awaitingAcknowledgement) {
      this.send({ type: 'overrun' });

      return false;
    }

    this.awaitingAcknowledgement = true;
    this.send({ type: 'chunk', samples });

    return true;
  }

  // fallow-ignore-next-line unused-class-member -- The Web Audio rendering engine calls process for each input quantum.
  override process(inputs: Float32Array[][]) {
    if (!this.running) return false;

    const input = inputs[0]?.[0];

    if (!input?.length) return true;

    this.running = this.segments.write(input, (samples) => this.emit(samples));

    if (!this.started) {
      this.started = true;
      this.send({ type: 'started' });
    }

    return this.running;
  }
}

registerProcessor('study-microphone', MicrophoneProcessor);
