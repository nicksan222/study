/** Browser and webview microphone capture. Bounded mono PCM segments stay ephemeral. */
import { StudyError } from '@study/contracts';
import { Effect } from 'effect';

import { deferredPromise } from '../deferred-promise';
import processorUrl from './microphone-processor.ts?worker&url';
import { microphoneSampleRate } from './microphone-segments';
import type { MicrophoneCommand, MicrophoneMessage } from './microphone-segments';
import { runNativeExit } from './runtime.ts';

export interface MicrophoneCapture {
  stop: () => Promise<number[]>;
  cancel: () => void;
}

type CaptureOptions = {
  signal: AbortSignal;
  chunkSeconds: 10 | 20 | 30;
  onChunk: (samples: number[]) => void;
  onLevel?: (level: number) => void;
  onError: () => void;
};

export function microphoneAvailable() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined'
  );
}

function trackRelease(stream: MediaStream) {
  let released = false;

  return () => {
    if (released) return;

    released = true;

    for (const track of stream.getTracks()) track.stop();
  };
}

function cancelled() {
  return new DOMException('Cancelled', 'AbortError');
}

function endedUnexpectedly() {
  return new StudyError('internal', 'Microphone recording ended unexpectedly');
}

export async function captureMicrophone(options: CaptureOptions): Promise<MicrophoneCapture> {
  if (!microphoneAvailable())
    throw new StudyError('unsupported', 'Microphone capture requires a secure audio worklet');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  const releaseTracks = trackRelease(stream);

  try {
    if (options.signal.aborted) throw cancelled();

    return await connectMicrophone(stream, releaseTracks, options);
  } catch (cause) {
    releaseTracks();

    throw cause;
  }
}

function startupDeadline(signal: AbortSignal) {
  const deadline = new AbortController();
  const failure = deferredPromise<never>();
  const abort = () => failure.reject(cancelled());

  signal.addEventListener('abort', abort, { once: true });
  void failure.promise.catch(() => {});

  void runNativeExit(Effect.sleep('10 seconds'), deadline.signal).then((exit) => {
    if (exit._tag === 'Success')
      failure.reject(new StudyError('internal', 'Microphone did not start delivering audio'));
  });

  return {
    wait: <A>(pending: Promise<A>) => Promise.race([pending, failure.promise]),
    release: () => {
      deadline.abort();
      signal.removeEventListener('abort', abort);
    }
  };
}

async function connectMicrophone(
  stream: MediaStream,
  releaseTracks: () => void,
  options: CaptureOptions
) {
  const context = new AudioContext({ sampleRate: microphoneSampleRate });
  const startup = startupDeadline(options.signal);
  const release = () => {
    releaseTracks();
    void context.close().catch(() => {});
  };
  let cleanup = release;

  try {
    if (context.sampleRate !== microphoneSampleRate)
      throw new StudyError('unsupported', 'Microphone cannot produce 16 kHz audio');

    await startup.wait(context.audioWorklet.addModule(processorUrl));

    if (stream.getTracks().some((track) => track.readyState === 'ended')) throw endedUnexpectedly();

    const node = new AudioWorkletNode(context, 'study-microphone', {
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { framesPerChunk: options.chunkSeconds * microphoneSampleRate }
    });
    const source = context.createMediaStreamSource(stream);
    const firstFrame = deferredPromise<void>();
    const capture = bindCapture({ stream, node, source, release, firstFrame }, options);

    cleanup = capture.cancel;

    source.connect(node).connect(context.destination);
    await startup.wait(Promise.all([context.resume(), firstFrame.promise]));

    return capture;
  } catch (cause) {
    cleanup();

    throw cause;
  } finally {
    startup.release();
  }
}

type CaptureGraph = {
  stream: MediaStream;
  node: AudioWorkletNode;
  source: MediaStreamAudioSourceNode;
  release: () => void;
  firstFrame: ReturnType<typeof deferredPromise<void>>;
};

function bindCapture(
  { stream, node, source, release: releaseGraph, firstFrame }: CaptureGraph,
  options: CaptureOptions
) {
  const { signal, onChunk, onError, onLevel } = options;
  const finished = deferredPromise<number[]>();
  const deadline = new AbortController();
  const tracks = stream.getTracks();
  let closed = false;
  let stopping = false;

  void finished.promise.catch(() => {});
  void firstFrame.promise.catch(() => {});

  function release() {
    closed = true;
    deadline.abort();
    signal.removeEventListener('abort', cancel);

    for (const track of tracks) track.removeEventListener('ended', ended);

    node.onprocessorerror = null;
    node.port.onmessage = null;
    node.port.close();
    source.disconnect();
    node.disconnect();
    releaseGraph();
  }

  function cancel() {
    if (closed) return;

    release();
    firstFrame.reject(cancelled());
    finished.reject(cancelled());
  }

  function fail(cause: unknown) {
    if (closed) return;

    release();
    firstFrame.reject(cause);
    finished.reject(cause);
    onError();
  }

  function ended() {
    fail(endedUnexpectedly());
  }

  function send(command: MicrophoneCommand) {
    node.port.postMessage(command);
  }

  node.onprocessorerror = () => fail(new StudyError('internal', 'Microphone recording failed'));
  node.port.onmessage = ({ data }: MessageEvent<MicrophoneMessage>) => {
    try {
      switch (data.type) {
        case 'started':
          firstFrame.resolve();
          break;
        case 'level':
          onLevel?.(data.level);

          if (!closed) send('acknowledge-level');

          break;
        case 'chunk':
          onChunk(Array.from(data.samples));

          if (!closed) send('acknowledge');

          break;
        case 'stopped':
          release();
          finished.resolve(Array.from(data.samples));
          break;
        case 'overrun':
          fail(new StudyError('internal', 'Microphone input could not be delivered in time'));
          break;
      }
    } catch (cause) {
      fail(cause);
    }
  };

  for (const track of tracks) track.addEventListener('ended', ended, { once: true });

  signal.addEventListener('abort', cancel, { once: true });

  const stop = () => {
    if (!closed && !stopping) {
      stopping = true;
      send('stop');
      void runNativeExit(Effect.sleep('2 seconds'), deadline.signal).then((exit) => {
        if (exit._tag === 'Success')
          fail(new StudyError('internal', 'Microphone did not flush the final audio'));
      });
    }

    return finished.promise;
  };

  return { stop, cancel } satisfies MicrophoneCapture;
}
