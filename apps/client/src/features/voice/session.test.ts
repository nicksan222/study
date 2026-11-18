import { test } from '@study/testing';

import { DictationSession } from './session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function nextCaptureFailure(session: DictationSession) {
  const failed = deferred<void>();
  const unsubscribe = session.subscribe(() => {
    if (session.snapshot().error === 'capture') failed.resolve();
  });

  return failed.promise.finally(unsubscribe);
}

const ignoreTranscript = () => {};

test.unit.stable(
  'releases a microphone granted after cancellation without transcribing',
  async ({ expect, vi }) => {
    const granted = deferred<{ stop: () => Promise<number[]>; cancel: () => void }>();
    const cancel = vi.fn();
    const transcribe = vi.fn();
    const session = new DictationSession(() => granted.promise, transcribe);
    const owner = Symbol();
    const started = session.start(owner, ignoreTranscript);

    session.cancel(owner);
    granted.resolve({ stop: async () => [0.5], cancel });
    await started;
    expect(cancel).toHaveBeenCalledOnce();
    expect(transcribe).not.toHaveBeenCalled();
    expect(session.snapshot().phase).toBe('idle');
  }
);

test.unit.stable(
  'serializes recording and ignores transcription completed after cancellation',
  async ({ expect, vi }) => {
    const result = deferred<{ text: string }>();
    const requested = deferred<void>();
    const capture = { stop: async () => [0.5], cancel: vi.fn() };
    const session = new DictationSession(
      async () => capture,
      () => {
        requested.resolve();

        return result.promise;
      }
    );
    const owner = Symbol();
    const insert = vi.fn();

    await session.start(owner, insert);
    await session.start(Symbol(), insert);
    const stopped = session.stop(owner);

    expect(session.snapshot().phase).toBe('transcribing');
    await requested.promise;
    session.cancel(owner);
    result.resolve({ text: 'Ciao, come stai?' });
    await stopped;
    expect(session.snapshot().phase).toBe('idle');
    expect(insert).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'keeps recognized text available when insertion fails and allows retry without another transcription',
  async ({ expect, vi }) => {
    const transcribe = vi.fn(async () => ({ text: ' Ciao, come stai? ' }));
    const session = new DictationSession(
      async () => ({ stop: async () => [0.5], cancel: () => {} }),
      transcribe
    );
    const owner = Symbol();
    const insert = vi.fn(() => {
      throw new Error('Draft full');
    });

    await session.start(owner, insert);
    await session.stop(owner);
    expect(insert).toHaveBeenCalledExactlyOnceWith('Ciao, come stai?');
    expect(session.snapshot()).toMatchObject({
      phase: 'result',
      error: 'insert',
      transcript: 'Ciao, come stai?'
    });
    const retry = vi.fn();

    session.insert(owner, retry);
    expect(retry).toHaveBeenCalledWith('Ciao, come stai?');
    expect(transcribe).toHaveBeenCalledOnce();
    expect(session.snapshot().phase).toBe('idle');
  }
);

test.unit.stable(
  'reports silence without inserting and retains audio for a failed transcription retry',
  async ({ expect }) => {
    let attempts = 0;
    const session = new DictationSession(
      async () => ({ stop: async () => [0.5], cancel: () => {} }),
      async () => {
        if (++attempts === 1) throw new Error('Unavailable');

        return { text: '   ' };
      }
    );
    const owner = Symbol();

    await session.start(owner, ignoreTranscript);
    await session.stop(owner);
    expect(session.snapshot().error).toBe('transcribe');
    await session.retry(owner);
    expect(session.snapshot().error).toBe('empty');
    expect(attempts).toBe(2);
  }
);

test.unit.stable(
  'another editor can start a recording after capture failure or silence',
  async ({ expect }) => {
    let attempts = 0;
    const session = new DictationSession(
      async () => {
        if (++attempts === 1) throw new Error('Permission denied');

        return { stop: async () => [0], cancel: () => {} };
      },
      async () => ({ text: '' })
    );
    const owner = Symbol();
    const nextOwner = Symbol();

    await session.start(owner, ignoreTranscript);
    expect(session.snapshot().error).toBe('capture');
    await session.start(nextOwner, ignoreTranscript);
    expect(session.snapshot()).toMatchObject({ phase: 'recording', owner: nextOwner });
    await session.stop(nextOwner);
    expect(session.snapshot().error).toBe('empty');
    await session.start(owner, ignoreTranscript);
    expect(session.snapshot().phase).toBe('recording');
    session.cancel(owner);
  }
);

test.unit.stable(
  'reports recorder failure and ignores callbacks from an abandoned capture',
  async ({ expect, vi }) => {
    const callbacks: { onError: () => void; onChunk: (samples: number[]) => void }[] = [];
    const captures: { stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = [];
    const session = new DictationSession(async (options) => {
      callbacks.push(options);
      const capture = { stop: vi.fn(async () => [0.5]), cancel: vi.fn() };

      captures.push(capture);

      return capture;
    }, vi.fn());
    const owner = Symbol();

    await session.start(owner, ignoreTranscript);
    const failed = nextCaptureFailure(session);

    callbacks[0]!.onError?.();
    await failed;
    expect(session.snapshot()).toMatchObject({ phase: 'error', owner, error: 'capture' });
    expect(captures[0]!.cancel).toHaveBeenCalledOnce();
    await session.start(owner, ignoreTranscript);
    callbacks[0]!.onError?.();
    callbacks[0]!.onChunk([0.5]);
    expect(session.snapshot()).toMatchObject({ phase: 'recording', owner });
    expect(captures[1]!.stop).not.toHaveBeenCalled();
    session.cancel(owner);
  }
);

test.unit.stable(
  'delivers each ordered result while recording and after stopping',
  async ({ expect, vi }) => {
    const second = deferred<{ text: string }>();
    const requested = deferred<void>();
    const partial = deferred<void>();
    const lengths: number[] = [];
    let emit!: (samples: number[]) => void;
    const session = new DictationSession(
      async ({ onChunk }) => {
        emit = onChunk;

        return { stop: async () => [0.5], cancel: () => {} };
      },
      async (samples) => {
        lengths.push(samples.length);

        if (lengths.length === 1) return { text: 'Prima frase.' };

        requested.resolve();

        return second.promise;
      }
    );
    const owner = Symbol();

    const insert = vi.fn(() => {
      partial.resolve();
    });

    await session.start(owner, insert, 10);
    emit(Array(160_000).fill(0));
    await partial.promise;
    expect(session.snapshot().phase).toBe('recording');
    expect(insert).toHaveBeenCalledExactlyOnceWith('Prima frase.');
    const stopped = session.stop(owner);

    await requested.promise;
    expect(lengths).toEqual([160_000, 1]);
    second.resolve({ text: 'Seconda frase.' });
    await stopped;
    expect(insert.mock.calls).toEqual([['Prima frase.'], ['Seconda frase.']]);
    expect(session.snapshot().phase).toBe('idle');
  }
);

test.unit.stable(
  'stops on recognition backlog and retries only the unacknowledged audio in order',
  async ({ expect, vi }) => {
    let emit!: (samples: number[]) => void;
    const failed = Promise.withResolvers<{ text: string }>();
    const started = deferred<void>();
    const retryReady = deferred<void>();
    const calls: number[] = [];
    const session = new DictationSession(
      async ({ onChunk }) => {
        emit = onChunk;

        return { stop: async () => [4], cancel: () => {} };
      },
      async ([sample]) => {
        calls.push(sample!);

        if (calls.length === 2) {
          started.resolve();

          return failed.promise;
        }

        return { text: String(sample) };
      }
    );
    const owner = Symbol();
    const partial = deferred<void>();
    const insert = vi.fn((text: string) => {
      if (text === '1') partial.resolve();
    });

    session.subscribe(() => {
      if (session.snapshot().error === 'transcribe') retryReady.resolve();
    });
    await session.start(owner, insert);
    emit([1]);
    await partial.promise;
    emit([2]);
    await started.promise;
    emit([3]);
    expect(session.snapshot()).toMatchObject({ phase: 'transcribing', backlog: true });
    failed.reject(new Error('Interrupted'));
    await retryReady.promise;
    await session.retry(owner);
    expect(calls).toEqual([1, 2, 2, 3, 4]);
    expect(insert.mock.calls).toEqual([['1'], ['2'], ['3'], ['4']]);
    expect(session.snapshot().phase).toBe('idle');
  }
);

test.unit.stable(
  'drains complete audio segments even if the final flush fails',
  async ({ expect, vi }) => {
    const requested = deferred<void>();
    const recognized = deferred<{ text: string }>();
    let emit!: (samples: number[]) => void;
    const session = new DictationSession(
      async ({ onChunk }) => {
        emit = onChunk;

        return {
          stop: async () => {
            throw new Error('Final audio unavailable');
          },
          cancel: () => {}
        };
      },
      () => {
        requested.resolve();

        return recognized.promise;
      }
    );
    const owner = Symbol();
    const insert = vi.fn();

    await session.start(owner, insert);
    emit([0.5]);
    await requested.promise;
    const stopped = session.stop(owner);

    recognized.resolve({ text: 'Complete segment' });
    await stopped;
    expect(insert).toHaveBeenCalledExactlyOnceWith('Complete segment');
    expect(session.snapshot()).toMatchObject({ phase: 'error', error: 'capture' });
  }
);

test.unit.stable(
  'keeps delivered speech in its consumer and reports subsequent microphone failure',
  async ({ expect, vi }) => {
    let capture!: { onChunk: (samples: number[]) => void; onError: () => void };
    const partial = deferred<void>();
    const session = new DictationSession(
      async (options) => {
        capture = options;

        return { stop: async () => [], cancel: () => {} };
      },
      async () => ({ text: 'Confirmed speech' })
    );
    const owner = Symbol();

    const insert = vi.fn(() => {
      partial.resolve();
    });

    await session.start(owner, insert);
    capture.onChunk([1]);
    await partial.promise;
    const failed = nextCaptureFailure(session);

    capture.onError();
    await failed;
    expect(session.snapshot()).toMatchObject({
      phase: 'error',
      error: 'capture',
      transcript: ''
    });
    expect(insert).toHaveBeenCalledExactlyOnceWith('Confirmed speech');
  }
);

test.unit.stable.for([
  { retryNeeded: false, initial: '2', final: '3', expected: '2 3' },
  { retryNeeded: true, initial: '2', final: '3', expected: '2 3' },
  { retryNeeded: false, initial: 'See (', final: 'Appendix A)', expected: 'See (Appendix A)' }
])(
  'recovers only undelivered segments and preserves spacing in $expected (retry: $retryNeeded)',
  async ({ retryNeeded, initial, final, expected }, { expect, vi }) => {
    let emit!: (samples: number[]) => void;
    let failLast = retryNeeded;
    const first = deferred<void>();
    const recovery = deferred<void>();
    const session = new DictationSession(
      async ({ onChunk }) => {
        emit = onChunk;

        return { stop: async () => [3], cancel: () => {} };
      },
      async ([sample]) => {
        if (sample === 3 && failLast) {
          failLast = false;

          throw new Error('Recognition unavailable');
        }

        return { text: sample === 1 ? '1' : sample === 2 ? initial : final };
      }
    );
    const owner = Symbol();
    const insert = vi.fn((text: string) => {
      if (text === initial) throw new Error('Editor unavailable');

      first.resolve();
    });

    session.subscribe(() => {
      if (session.snapshot().phase === 'result' || session.snapshot().error === 'transcribe')
        recovery.resolve();
    });
    await session.start(owner, insert);
    emit([1]);
    await first.promise;
    emit([2]);
    await recovery.promise;

    if (retryNeeded) {
      expect(session.snapshot()).toMatchObject({
        phase: 'error',
        error: 'transcribe',
        transcript: initial
      });
      await session.retry(owner);
    }

    expect(insert.mock.calls).toEqual([['1'], [initial]]);
    expect(session.snapshot()).toMatchObject({
      phase: 'result',
      error: 'insert',
      transcript: expected
    });
  }
);
