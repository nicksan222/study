import { Effect, Stream } from 'effect';

/** Unacknowledged audio stays available for retries, including the request currently in flight. */
export class DictationAudio {
  private pending: number[][] = [];
  private changed = Promise.withResolvers<void>();
  private closed = false;

  push(samples: number[]) {
    if (samples.length) this.pending.push(samples);

    this.notify();

    return this.pending.length;
  }

  close() {
    this.closed = true;
    this.notify();
  }

  private notify() {
    this.changed.resolve();
    this.changed = Promise.withResolvers<void>();
  }

  private async *chunks() {
    while (true) {
      const next = this.pending[0];

      if (next) yield next;
      else if (this.closed) return;
      else await this.changed.promise;
    }
  }

  /** Each subscriber sees ordered text while the transport sends one audio request at a time. */
  recognize(
    recognize: (samples: number[], signal: AbortSignal) => Promise<{ text: string }>,
    signal: AbortSignal
  ) {
    const audio = Stream.fromAsyncIterable(this.chunks(), (error) => error);

    return audio.pipe(
      Stream.mapEffect((samples) =>
        Effect.tryPromise(async (interrupted) => {
          signal.throwIfAborted();
          const result = await recognize(samples, AbortSignal.any([signal, interrupted]));

          signal.throwIfAborted();
          this.pending.shift();

          return result.text.trim();
        })
      )
    );
  }
}
