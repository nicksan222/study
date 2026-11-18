import { test } from '@study/testing';

import { DictationSession } from './session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

test.unit.stable(
  'releases a microphone granted after cancellation without transcribing',
  async ({ expect, vi }) => {
    const granted = deferred<{ stop: () => Promise<number[]>; cancel: () => void }>();
    const cancel = vi.fn();
    const transcribe = vi.fn();
    const session = new DictationSession(() => granted.promise, transcribe);
    const owner = Symbol();
    const started = session.start(owner);

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
    const capture = { stop: async () => [0.5], cancel: vi.fn() };
    const session = new DictationSession(
      async () => capture,
      () => result.promise
    );
    const owner = Symbol();

    await session.start(owner);
    await session.start(Symbol());
    const stopped = session.stop(owner);

    expect(session.snapshot().phase).toBe('transcribing');
    session.cancel(owner);
    result.resolve({ text: 'Ciao, come stai?' });
    await stopped;
    expect(session.snapshot().phase).toBe('idle');
    expect(session.snapshot().transcript).toBe('');
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

    await session.start(owner);
    await session.stop(owner);
    const insert = vi.fn(() => {
      throw new Error('Draft full');
    });

    session.insert(owner, insert);
    expect(session.snapshot().phase).toBe('result');
    expect(session.snapshot().transcript).toBe('Ciao, come stai?');
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

    await session.start(owner);
    await session.stop(owner);
    expect(session.snapshot().error).toBe('transcribe');
    await session.retry(owner);
    expect(session.snapshot().error).toBe('empty');
    expect(attempts).toBe(2);
  }
);

test.unit.stable(
  'starts a new recording directly after capture failure or silence',
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

    await session.start(owner);
    expect(session.snapshot().error).toBe('capture');
    await session.start(owner);
    expect(session.snapshot().phase).toBe('recording');
    await session.stop(owner);
    expect(session.snapshot().error).toBe('empty');
    await session.start(owner);
    expect(session.snapshot().phase).toBe('recording');
    session.cancel(owner);
  }
);

test.unit.stable(
  'reports recorder failure immediately and ignores callbacks from an abandoned capture',
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

    await session.start(owner);
    callbacks[0]!.onError?.();
    expect(session.snapshot()).toMatchObject({ phase: 'error', owner, error: 'capture' });
    expect(captures[0]!.cancel).toHaveBeenCalledOnce();
    await session.start(owner);
    callbacks[0]!.onError?.();
    callbacks[0]!.onChunk([0.5]);
    expect(session.snapshot()).toMatchObject({ phase: 'recording', owner });
    expect(captures[1]!.stop).not.toHaveBeenCalled();
    session.cancel(owner);
  }
);

test.unit.stable(
  'streams ordered results while recording and inserts only after the final segment',
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

    session.subscribe(() => {
      if (session.snapshot().transcript) partial.resolve();
    });
    await session.start(owner, 10);
    emit(Array(160_000).fill(0));
    await partial.promise;
    expect(session.snapshot()).toMatchObject({ phase: 'recording', transcript: 'Prima frase.' });
    const insert = vi.fn();

    session.insert(owner, insert);
    expect(insert).not.toHaveBeenCalled();
    const stopped = session.stop(owner);

    await requested.promise;
    expect(lengths).toEqual([160_000, 1]);
    second.resolve({ text: 'Seconda frase.' });
    await stopped;
    session.insert(owner, insert);
    expect(insert).toHaveBeenCalledExactlyOnceWith('Prima frase. Seconda frase.');
  }
);

test.unit.stable(
  'stops on recognition backlog and retries only the unacknowledged audio in order',
  async ({ expect }) => {
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

    session.subscribe(() => {
      if (session.snapshot().transcript === '1') partial.resolve();

      if (session.snapshot().error === 'transcribe') retryReady.resolve();
    });
    await session.start(owner);
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
    expect(session.snapshot()).toMatchObject({ phase: 'result', transcript: '1 2 3 4' });
  }
);

test.unit.stable(
  'keeps confirmed speech for manual recovery after microphone failure',
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

    session.subscribe(() => {
      if (session.snapshot().transcript) partial.resolve();
    });
    await session.start(owner);
    capture.onChunk([1]);
    await partial.promise;
    capture.onError();
    expect(session.snapshot()).toMatchObject({
      phase: 'result',
      error: 'interrupted',
      transcript: 'Confirmed speech'
    });
    const insert = vi.fn();

    session.insert(owner, insert);
    expect(insert).toHaveBeenCalledExactlyOnceWith('Confirmed speech');
  }
);
