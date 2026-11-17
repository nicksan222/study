/** Browser and webview microphone capture. Audio stays ephemeral and is normalized to mono 16kHz. */
import { StudyError } from '@study/contracts';
import { Effect } from 'effect';

import { runNativeExit } from './runtime.ts';

export interface MicrophoneCapture {
  stop: () => Promise<number[]>;
  cancel: () => void;
}

export function microphoneAvailable() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

export async function captureMicrophone({
  signal,
  onLimit,
  onError
}: {
  signal: AbortSignal;
  onLimit: () => void;
  onError: () => void;
}): Promise<MicrophoneCapture> {
  if (!microphoneAvailable())
    throw new StudyError('unsupported', 'Microphone capture requires a secure browser context');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  if (signal.aborted) {
    release();

    throw new DOMException('Cancelled', 'AbortError');
  }

  const chunks: Blob[] = [];
  let recorder: MediaRecorder;

  try {
    recorder = new MediaRecorder(stream);
  } catch (cause) {
    release();

    throw cause;
  }

  let settle!: () => void;
  let fail!: (cause: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  // Attach immediately: cancel can trigger stop without anyone awaiting decoding.
  void finished.catch(() => {});
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = settle;
  recorder.onerror = () => {
    stopTracks();
    fail(new StudyError('internal', 'Microphone recording failed'));
    onError();
  };
  const stopTracks = () => {
    deadline.abort();
    signal.removeEventListener('abort', cancel);

    if (recorder.state !== 'inactive') recorder.stop();

    release();
  };
  const cancel = () => {
    stopTracks();
    chunks.length = 0;
  };
  const deadline = new AbortController();

  void runNativeExit(Effect.sleep('60 seconds'), deadline.signal).then((exit) => {
    if (exit._tag === 'Success') onLimit();
  });

  signal.addEventListener('abort', cancel, { once: true });

  try {
    recorder.start(1000);
  } catch (cause) {
    cancel();

    throw cause;
  }

  return {
    cancel,
    stop: async () => {
      stopTracks();
      await finished;

      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');

      const context = new AudioContext();

      try {
        const decoded = await context.decodeAudioData(
          await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer()
        );

        chunks.length = 0;
        const frames = Math.min(960_000, Math.round(decoded.duration * 16_000));

        if (!frames) throw new StudyError('invalid_input', 'Empty recording');

        const offline = new OfflineAudioContext(1, frames, 16_000);
        const source = offline.createBufferSource();

        source.buffer = decoded;
        source.connect(offline.destination);
        source.start();
        const audio = await offline.startRendering();

        return Array.from(audio.getChannelData(0));
      } finally {
        await context.close();
      }
    }
  };
}
