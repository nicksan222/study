import { test } from '@study/testing';

import { captureMicrophone } from './microphone';

class Recorder {
  static current: Recorder;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable?: (event: BlobEvent) => void;
  onstop?: () => void;
  onerror?: () => void;

  constructor() {
    Recorder.current = this;
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
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
  const stream = {
    getTracks: () => [
      {
        stop: () => {
          active = false;
        }
      }
    ]
  } as unknown as MediaStream;

  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: async () => stream },
    configurable: true
  });

  return { stream, active: () => active };
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
      onLimit: () => {},
      onError: () => {}
    });

    controller.abort();
    permission.resolve(fixture.stream);
    await expect(pending).rejects.toThrow('Cancelled');
    expect(fixture.active()).toBe(false);
  }
);

test.unit.stable(
  'releases recording resources on cancellation without decoding audio',
  async ({ vi, expect }) => {
    const fixture = prepare(vi);
    const controller = new AbortController();

    await captureMicrophone({ signal: controller.signal, onLimit: () => {}, onError: () => {} });
    expect(fixture.active()).toBe(true);
    controller.abort();
    expect(fixture.active()).toBe(false);
    expect(Recorder.current.state).toBe('inactive');
  }
);

test.unit.stable(
  'releases recording resources after recorder failure and preserves the error',
  async ({ vi, expect }) => {
    const fixture = prepare(vi);
    const onError = vi.fn();
    const capture = await captureMicrophone({
      signal: new AbortController().signal,
      onLimit: () => {},
      onError
    });

    Recorder.current.onerror?.();
    expect(onError).toHaveBeenCalledOnce();
    expect(fixture.active()).toBe(false);
    await expect(capture.stop()).rejects.toThrow('Microphone recording failed');
  }
);
