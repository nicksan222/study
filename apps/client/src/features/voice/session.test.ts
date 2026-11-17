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
    const callbacks: { onError: () => void; onLimit: () => void }[] = [];
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
    callbacks[0]!.onLimit();
    expect(session.snapshot()).toMatchObject({ phase: 'recording', owner });
    expect(captures[1]!.stop).not.toHaveBeenCalled();
    session.cancel(owner);
  }
);
