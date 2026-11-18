import { test } from '@study/testing';
import { Stream } from 'effect';

import { DictationAudio } from './recognition-stream';

test.unit.stable(
  'transcribes and forwards cancellation when WebKit lacks newer promise and abort APIs',
  async ({ expect, vi }) => {
    const replyStarted = Promise.withResolvers<AbortSignal>();
    const withResolvers = vi.spyOn(Promise, 'withResolvers').mockImplementation(() => {
      throw new Error('Promise.withResolvers is unavailable');
    });
    const any = vi.spyOn(AbortSignal, 'any').mockImplementation(() => {
      throw new Error('AbortSignal.any is unavailable');
    });
    const throwIfAborted = vi
      .spyOn(AbortSignal.prototype, 'throwIfAborted')
      .mockImplementation(() => {
        throw new Error('AbortSignal.throwIfAborted is unavailable');
      });
    const controller = new AbortController();

    try {
      const audio = new DictationAudio();

      audio.push([1]);
      audio.push([2]);
      audio.close();
      const results = Stream.toAsyncIterable(
        audio.recognize(async ([value], signal) => {
          if (value === 1) return { text: ' First words ' };

          replyStarted.resolve(signal);

          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }, controller.signal)
      )[Symbol.asyncIterator]();

      await expect(results.next()).resolves.toEqual({ value: 'First words', done: false });
      const failed = expect(results.next()).rejects.toBeDefined();
      const requestSignal = await replyStarted.promise;

      controller.abort(new Error('Cancelled recognition'));
      await failed;
      expect(requestSignal.aborted).toBe(true);
      expect(requestSignal.reason).toMatchObject({ message: 'Cancelled recognition' });
    } finally {
      controller.abort();
      withResolvers.mockRestore();
      any.mockRestore();
      throwIfAborted.mockRestore();
    }
  }
);
