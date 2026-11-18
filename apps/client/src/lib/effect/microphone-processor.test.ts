import { test } from '@study/testing';

import type { MicrophoneCommand, MicrophoneMessage } from './microphone-segments';

test.unit.stable(
  'limits queued worklet audio and accepts a new chunk after acknowledgement',
  async ({ vi, expect }) => {
    const messages: MicrophoneMessage[] = [];

    vi.stubGlobal(
      'AudioWorkletProcessor',
      class {
        port = {
          onmessage: null as ((event: { data: MicrophoneCommand }) => void) | null,
          postMessage: (message: MicrophoneMessage) => messages.push(message)
        };
      }
    );
    vi.stubGlobal('registerProcessor', vi.fn());

    try {
      const { default: MicrophoneProcessor } = await import('./microphone-processor');
      const processor = new MicrophoneProcessor({ processorOptions: { framesPerChunk: 4 } });
      const audio = Float32Array.of(0.1, 0.2, 0.3, 0.4);

      expect(processor.process([[audio]])).toBe(true);
      expect(messages.map((message) => message.type)).toEqual(['chunk', 'started']);
      processor.port.onmessage?.(
        new MessageEvent<MicrophoneCommand>('message', { data: 'acknowledge' })
      );
      expect(processor.process([[audio]])).toBe(true);
      expect(processor.process([[audio]])).toBe(false);
      expect(messages.map((message) => message.type)).toEqual([
        'chunk',
        'started',
        'chunk',
        'overrun'
      ]);
      expect(processor.process([[audio]])).toBe(false);

      const meter = new MicrophoneProcessor({ processorOptions: { framesPerChunk: 160_000 } });

      messages.length = 0;
      const renderBlock = new Float32Array(128).fill(0.25);

      for (let index = 0; index < 9; index++) expect(meter.process([[renderBlock]])).toBe(true);

      expect(messages.filter((message) => message.type === 'level')).toEqual([]);
      expect(meter.process([[renderBlock]])).toBe(true);
      expect(meter.process([[new Float32Array(1280).fill(0.5)]])).toBe(true);
      meter.port.onmessage?.(
        new MessageEvent<MicrophoneCommand>('message', { data: 'acknowledge-level' })
      );
      expect(meter.process([[new Float32Array(1280)]])).toBe(true);
      expect(messages.filter((message) => message.type === 'level')).toEqual([
        { type: 'level', level: 0.25 },
        { type: 'level', level: 0 }
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  }
);
