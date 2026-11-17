/** One microphone owner across all mounted dictation controls; cancellation fences late results. */
import type { MicrophoneCapture } from '#client/lib/host.ts';

type Snapshot = {
  phase: 'idle' | 'starting' | 'recording' | 'transcribing' | 'result' | 'error';
  owner?: symbol;
  transcript: string;
  error?: 'capture' | 'transcribe' | 'empty' | 'insert';
};

export class DictationSession {
  private state: Snapshot = { phase: 'idle', transcript: '' };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private capture?: MicrophoneCapture;
  private samples?: number[];
  private generation = 0;

  constructor(
    private readonly acquire: (options: {
      signal: AbortSignal;
      onLimit: () => void;
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

  private publish(state: Snapshot) {
    this.state = state;

    for (const listener of this.listeners) listener();
  }

  private canRestart() {
    return this.state.phase === 'error' && this.state.error !== 'transcribe';
  }

  async start(owner: symbol) {
    if (this.state.owner === owner && this.canRestart()) this.cancel(owner);

    if (this.state.phase !== 'idle') return;

    const generation = ++this.generation;
    const controller = new AbortController();

    this.controller = controller;
    this.publish({ phase: 'starting', owner, transcript: '' });

    try {
      const capture = await this.acquire({
        signal: controller.signal,
        onLimit: () => {
          void this.stop(owner);
        }
      });

      if (generation !== this.generation) {
        capture.cancel();

        return;
      }

      this.capture = capture;
      this.publish({ phase: 'recording', owner, transcript: '' });
    } catch {
      if (generation === this.generation)
        this.publish({ phase: 'error', owner, transcript: '', error: 'capture' });
    }
  }

  async stop(owner: symbol) {
    if (this.state.owner !== owner || this.state.phase !== 'recording') return;

    const generation = this.generation;
    const capture = this.capture!;

    this.capture = undefined;
    this.publish({ phase: 'transcribing', owner, transcript: '' });

    try {
      const samples = await capture.stop();

      if (generation !== this.generation) return;

      this.samples = samples;
      await this.decode(owner, generation);
    } catch {
      if (generation === this.generation)
        this.publish({ phase: 'error', owner, transcript: '', error: 'capture' });
    }
  }

  private async decode(owner: symbol, generation: number) {
    this.publish({ phase: 'transcribing', owner, transcript: '' });

    try {
      const result = await this.transcribe(this.samples!, this.controller!.signal);

      if (generation !== this.generation) return;

      const transcript = result.text.trim();

      this.publish(
        transcript
          ? { phase: 'result', owner, transcript }
          : { phase: 'error', owner, transcript: '', error: 'empty' }
      );
      this.samples = undefined;
    } catch {
      if (generation === this.generation)
        this.publish({ phase: 'error', owner, transcript: '', error: 'transcribe' });
    }
  }

  async retry(owner: symbol) {
    if (this.state.owner === owner && this.state.error === 'transcribe' && this.samples)
      await this.decode(owner, this.generation);
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

    this.generation++;
    this.controller?.abort();
    this.capture?.cancel();
    this.capture = undefined;
    this.samples = undefined;
    this.publish({ phase: 'idle', transcript: '' });
  }
}
