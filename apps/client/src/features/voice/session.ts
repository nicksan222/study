/** One microphone owner across all mounted dictation controls; cancellation fences late results. */
import { failureSchema } from '@study/contracts';
import type { ErrorKind, VoiceSettings } from '@study/contracts';
import { Schema, Stream } from 'effect';

import type { MicrophoneCapture } from '#client/lib/host.ts';

import { DictationAudio } from './recognition-stream';
import { insertTranscript } from './text-insertion';

const defaultChunkSeconds = 30;

type Snapshot = {
  phase: 'idle' | 'starting' | 'recording' | 'transcribing' | 'result' | 'error';
  owner?: symbol;
  transcript: string;
  backlog?: boolean;
  error?: 'capture' | 'transcribe' | 'empty' | 'insert' | 'interrupted';
  transcriptionFailure?: ErrorKind;
};

type Recording = {
  controller: AbortController;
  audio: DictationAudio;
  onTranscript: (text: string) => void;
  delivered: boolean;
  undelivered: string;
  capture?: MicrophoneCapture;
  captureFailed?: boolean;
  backlog?: boolean;
  finishing?: Promise<void>;
  recognition?: Promise<void>;
};

export class DictationSession {
  private state: Snapshot = { phase: 'idle', transcript: '' };
  private listeners = new Set<() => void>();
  private levelListeners = new Set<(level: number) => void>();
  private recording?: Recording;

  constructor(
    private readonly acquire: (options: {
      signal: AbortSignal;
      chunkSeconds: NonNullable<VoiceSettings['chunkSeconds']>;
      onChunk: (samples: number[]) => void;
      onLevel: (level: number) => void;
      onError: () => void;
    }) => Promise<MicrophoneCapture>,
    private readonly transcribe: (
      samples: number[],
      signal: AbortSignal
    ) => Promise<{ text: string }>
  ) {}

  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeLevel = (listener: (level: number) => void) => {
    this.levelListeners.add(listener);

    return () => {
      this.levelListeners.delete(listener);
    };
  };

  private publish(state: Snapshot) {
    this.state = state;

    for (const listener of this.listeners) listener();
  }

  private canRestart() {
    return this.state.phase === 'error' && this.state.error !== 'transcribe';
  }

  async start(
    owner: symbol,
    onTranscript: (text: string) => void,
    chunkSeconds: VoiceSettings['chunkSeconds'] = defaultChunkSeconds
  ) {
    if (this.state.owner && this.canRestart()) this.cancel(this.state.owner);

    if (this.state.phase !== 'idle') return;

    const recording: Recording = {
      controller: new AbortController(),
      audio: new DictationAudio(),
      onTranscript,
      delivered: false,
      undelivered: ''
    };

    this.recording = recording;
    this.publish({ phase: 'starting', owner, transcript: '' });

    try {
      const capture = await this.acquire({
        signal: recording.controller.signal,
        chunkSeconds,
        onChunk: (samples) => this.acceptChunk(recording, owner, samples),
        onLevel: (level) => {
          if (this.recording !== recording || this.state.phase !== 'recording') return;

          for (const listener of this.levelListeners) listener(level);
        },
        onError: () => this.failCapture(recording, owner)
      });

      if (this.recording !== recording) {
        capture.cancel();

        return;
      }

      recording.capture = capture;
      this.publish({ phase: 'recording', owner, transcript: '' });
      recording.recognition = this.consume(recording, owner);
    } catch {
      this.failCapture(recording, owner);
    }
  }

  private acceptChunk(recording: Recording, owner: symbol, samples: number[]) {
    if (this.recording !== recording || recording.captureFailed) return;

    // Two outstanding segments leave room for the final segment flushed by stop.
    if (recording.audio.push(samples) >= 2 && this.state.phase === 'recording') {
      recording.backlog = true;
      void this.stop(owner);
    }
  }

  private failCapture(recording: Recording, owner: symbol) {
    if (this.recording !== recording || recording.captureFailed) return;

    const capture = recording.capture;

    if (!capture) {
      this.release();
      this.publish({ phase: 'error', owner, transcript: '', error: 'capture' });

      return;
    }

    recording.captureFailed = true;
    recording.capture = undefined;
    capture.cancel();
    recording.audio.close();
    this.publish({ ...this.state, phase: 'transcribing' });
  }

  async stop(owner: symbol) {
    const recording = this.recording;

    if (!recording || this.state.owner !== owner || this.state.phase !== 'recording') return;

    await this.finishCapture(recording, owner);
    await recording.recognition;
  }

  private finishCapture(recording: Recording, owner: symbol) {
    const capture = recording.capture;

    if (recording.finishing) return recording.finishing;

    if (!capture) return Promise.resolve();

    this.publish({ ...this.state, phase: 'transcribing', backlog: recording.backlog });

    recording.finishing = Promise.resolve()
      .then(() => capture.stop())
      .then((samples) => {
        if (this.recording === recording && !recording.captureFailed) recording.audio.push(samples);
      })
      .catch(() => this.failCapture(recording, owner))
      .finally(() => recording.audio.close());

    return recording.finishing;
  }

  private async consume(recording: Recording, owner: symbol) {
    try {
      const results = recording.audio.recognize(this.transcribe, recording.controller.signal);

      for await (const text of Stream.toAsyncIterable(results)) {
        if (this.recording !== recording) return;

        if (text) this.deliver(recording, owner, text);
      }

      if (this.recording !== recording) return;

      this.complete(recording, owner);
    } catch (failure) {
      if (this.recording !== recording) return;

      await this.finishCapture(recording, owner);

      if (this.recording === recording)
        this.publish({
          ...this.state,
          phase: 'error',
          error: 'transcribe',
          transcriptionFailure: Schema.is(failureSchema)(failure) ? failure.kind : undefined,
          transcript: recording.undelivered
        });
    }
  }

  private deliver(recording: Recording, owner: symbol, text: string) {
    if (recording.undelivered) {
      recording.undelivered = insertTranscript(recording.undelivered, text).value;

      return;
    }

    try {
      recording.onTranscript(text);
      recording.delivered = true;
    } catch {
      recording.undelivered = text;
      void this.stop(owner);
    }
  }

  private complete(recording: Recording, owner: symbol) {
    this.release();

    if (recording.undelivered) {
      this.publish({
        phase: 'result',
        owner,
        transcript: recording.undelivered,
        error: recording.captureFailed ? 'interrupted' : 'insert'
      });
    } else if (recording.captureFailed) {
      this.publish({ phase: 'error', owner, transcript: '', error: 'capture' });
    } else if (recording.delivered) this.publish({ phase: 'idle', transcript: '' });
    else this.publish({ phase: 'error', owner, transcript: '', error: 'empty' });
  }

  async retry(owner: symbol) {
    const recording = this.recording;

    if (!recording || this.state.owner !== owner || this.state.error !== 'transcribe') return;

    this.publish({
      ...this.state,
      phase: 'transcribing',
      error: undefined,
      transcriptionFailure: undefined,
      transcript: ''
    });
    recording.recognition = this.consume(recording, owner);
    await recording.recognition;
  }

  insert(owner: symbol, insert: (text: string) => void) {
    if (this.state.owner !== owner || this.state.phase !== 'result') return;

    try {
      insert(this.state.transcript);
      this.cancel(owner);
    } catch {
      this.publish({ ...this.state, error: 'insert' });
    }
  }

  cancel(owner: symbol) {
    if (this.state.owner !== owner) return;

    this.release();
    this.publish({ phase: 'idle', transcript: '' });
  }

  private release() {
    const recording = this.recording;

    this.recording = undefined;
    recording?.controller.abort();
    recording?.capture?.cancel();
    recording?.audio.close();
  }
}
