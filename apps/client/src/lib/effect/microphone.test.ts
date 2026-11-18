import { test } from '@study/testing';

import { captureMicrophone } from './microphone';
import type { MicrophoneMessage } from './microphone-segments';

class WorkletNode {
  static current: WorkletNode;
  static startImmediately = true;
  static connected = Promise.withResolvers<void>();
  readonly commands: string[] = [];
  onprocessorerror: (() => void) | null = null;
  port = {
    onmessage: null as ((event: { data: MicrophoneMessage }) => void) | null,
    postMessage: (command: string) => {
      this.commands.push(command);
    },
    close: () => {}
  };

  constructor(
    _context: AudioContext,
    _name: string,
    readonly options: AudioWorkletNodeOptions
  ) {
    WorkletNode.current = this;
  }

  connect() {
    WorkletNode.connected.resolve();

    if (WorkletNode.startImmediately) this.deliver({ type: 'started' });
  }

  disconnect() {}

  deliver(data: MicrophoneMessage) {
    this.port.onmessage?.({ data });
  }
}

class CaptureContext {
  static current: CaptureContext;
  sampleRate = 16_000;
  state = 'running';
  destination = {};
  audioWorklet = { addModule: async () => {} };

  constructor() {
    CaptureContext.current = this;
  }

  createMediaStreamSource() {
    return { connect: (node: WorkletNode) => node, disconnect: () => {} };
  }

  async resume() {}

  async close() {
    this.state = 'closed';
  }
}

const secureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

const mediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

test.unit.afterEach(({ vi }) => {
  vi.unstubAllGlobals();

  if (secureContext) Object.defineProperty(window, 'isSecureContext', secureContext);
  else Reflect.deleteProperty(window, 'isSecureContext');

  if (mediaDevices) Object.defineProperty(navigator, 'mediaDevices', mediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

function prepare(vi: test.unit.Context['vi']) {
  let active = true;

  WorkletNode.startImmediately = true;
  WorkletNode.connected = Promise.withResolvers<void>();
  const track = Object.assign(new EventTarget(), {
    stop: () => {
      active = false;
    }
  });
  const stream = { getTracks: () => [track] } as unknown as MediaStream;

  vi.stubGlobal('AudioContext', CaptureContext);
  vi.stubGlobal('AudioWorkletNode', WorkletNode);
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: async () => stream },
    configurable: true
  });

  return { stream, track, active: () => active };
}

test.unit.stable(
  'releases a microphone granted after the capture was aborted',
  async ({ vi, expect }) => {
    const fixture = prepare(vi);
    const permission = Promise.withResolvers<MediaStream>();

    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => permission.promise },
      configurable: true
    });
    const controller = new AbortController();
    const pending = captureMicrophone({
      signal: controller.signal,
      chunkSeconds: 10,
      onChunk: () => {},
      onError: () => {}
    });

    controller.abort();
    permission.resolve(fixture.stream);
    await expect(pending).rejects.toThrow('Cancelled');
    expect(fixture.active()).toBe(false);
  }
);

test.unit.stable(
  'releases recording resources on cancellation without publishing audio',
  async ({ vi, expect }) => {
    const fixture = prepare(vi);
    const controller = new AbortController();
    const onError = vi.fn();

    await captureMicrophone({
      signal: controller.signal,
      chunkSeconds: 10,
      onChunk: () => {},
      onError
    });
    expect(fixture.active()).toBe(true);
    controller.abort();
    expect(fixture.active()).toBe(false);
    expect(CaptureContext.current.state).toBe('closed');
    expect(WorkletNode.current.port.onmessage).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'reports an unexpected track-ending stop and rejects partial audio',
  async ({ vi, expect }) => {
    const fixture = prepare(vi);
    const onError = vi.fn();
    const controller = new AbortController();
    const capture = await captureMicrophone({
      signal: controller.signal,
      chunkSeconds: 10,
      onChunk: () => {},
      onError
    });

    try {
      fixture.track.dispatchEvent(new Event('ended'));
      expect(fixture.active()).toBe(false);
      expect(onError).toHaveBeenCalledOnce();
      await expect(capture.stop()).rejects.toThrow('Microphone recording ended unexpectedly');
    } finally {
      controller.abort();
    }
  }
);

test.unit.stable(
  'releases recording resources after worklet failure and preserves the error',
  async ({ vi, expect }) => {
    const fixture = prepare(vi);
    const onError = vi.fn();
    const capture = await captureMicrophone({
      signal: new AbortController().signal,
      chunkSeconds: 10,
      onChunk: () => {},
      onError
    });

    WorkletNode.current.onprocessorerror?.();
    expect(onError).toHaveBeenCalledOnce();
    expect(fixture.active()).toBe(false);
    await expect(capture.stop()).rejects.toThrow('Microphone recording failed');
  }
);

test.unit.stable(
  'delivers chunks while the microphone is active and flushes the final tail exactly once',
  async ({ vi, expect }) => {
    const fixture = prepare(vi);
    const onChunk = vi.fn();
    const onError = vi.fn();
    const capture = await captureMicrophone({
      signal: new AbortController().signal,
      chunkSeconds: 20,
      onChunk,
      onError
    });
    const worklet = WorkletNode.current;

    expect(worklet.options.processorOptions).toEqual({ framesPerChunk: 320_000 });

    worklet.deliver({ type: 'chunk', samples: Float32Array.of(0.5) });
    expect(onChunk).toHaveBeenCalledExactlyOnceWith([0.5]);
    expect(fixture.active()).toBe(true);
    expect(worklet.commands).toEqual(['acknowledge']);

    const tail = capture.stop();

    expect(capture.stop()).toBe(tail);
    expect(worklet.commands).toEqual(['acknowledge', 'stop']);
    worklet.deliver({ type: 'stopped', samples: Float32Array.of(0.25) });
    await expect(tail).resolves.toEqual([0.25]);
    expect(fixture.active()).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'aborts the final flush and detaches the worklet on cancellation',
  async ({ vi, expect }) => {
    const fixture = prepare(vi);
    const controller = new AbortController();
    const onChunk = vi.fn();
    const capture = await captureMicrophone({
      signal: controller.signal,
      chunkSeconds: 30,
      onChunk,
      onError: () => {}
    });
    const stopped = capture.stop();

    controller.abort();
    WorkletNode.current.deliver({ type: 'chunk', samples: Float32Array.of(0.5) });
    await expect(stopped).rejects.toThrow('Cancelled');
    expect(onChunk).not.toHaveBeenCalled();
    expect(fixture.active()).toBe(false);
  }
);

test.unit.stable(
  'aborts startup while the opened microphone has yet to provide its first frame',
  async ({ vi, expect }) => {
    const fixture = prepare(vi);
    const controller = new AbortController();
    const onError = vi.fn();

    WorkletNode.startImmediately = false;
    const pending = captureMicrophone({
      signal: controller.signal,
      chunkSeconds: 30,
      onChunk: () => {},
      onError
    });

    await WorkletNode.connected.promise;
    controller.abort();
    await expect(pending).rejects.toThrow('Cancelled');
    expect(fixture.active()).toBe(false);
    expect(CaptureContext.current.state).toBe('closed');
    expect(onError).not.toHaveBeenCalled();
  }
);
