import { Effect, Stream } from 'effect';

import { forwardAbort } from '#client/lib/abort.ts';
import { deferredPromise } from '#client/lib/deferred-promise.ts';

function requireActive(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
}

/** Unacknowledged audio stays available for retries, including the request currently in flight. */
export class DictationAudio {
  private pending: number[][] = [];
  private changed = deferredPromise<void>();
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
    this.changed = deferredPromise<void>();
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
        Effect.tryPromise({
          try: async (interrupted) => {
            const request = new AbortController();
            const cancel = forwardAbort(signal, request);
            const interrupt = forwardAbort(interrupted, request);

            try {
              requireActive(request.signal);
              const result = await recognize(samples, request.signal);

              requireActive(request.signal);
              this.pending.shift();

              return result.text.trim();
            } finally {
              cancel();
              interrupt();
            }
          },
          catch: (error) => error
        })
      )
    );
  }
}
