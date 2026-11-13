import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { signInOptions } from '../host';
import { startChatGptSignIn } from './ai-settings';

const api = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock('../host', () => ({ signInOptions: vi.fn() }));
vi.mock('./request', () => ({
  request: (invoke: (client: { 'auth.startSignIn': typeof api.start }) => Effect.Effect<unknown>) =>
    Effect.runPromise(invoke({ 'auth.startSignIn': api.start }))
}));
beforeEach(() => {
  vi.mocked(signInOptions).mockReturnValue({ callbackUrl: 'http://127.0.0.1:5173/auth/callback' });
  api.start
    .mockReset()
    .mockReturnValue(Effect.succeed({ url: 'https://auth.example', attemptId: 'test' }));
});

testStable('web sign-in supplies the browser callback endpoint', async () => {
  await startChatGptSignIn();
  expect(api.start).toHaveBeenCalledWith({
    callbackUrl: 'http://127.0.0.1:5173/auth/callback'
  });
});

testStable('native sign-in keeps its local callback listener transport', async () => {
  vi.mocked(signInOptions).mockReturnValue({});
  await startChatGptSignIn();
  expect(api.start).toHaveBeenCalledWith({});
});

testStable('invalid host sign-in options reject before starting authorization', async () => {
  const error = new Error('unsupported origin');

  vi.mocked(signInOptions).mockImplementation(() => {
    throw error;
  });
  await expect(startChatGptSignIn()).rejects.toBe(error);
  expect(api.start).not.toHaveBeenCalled();
});
