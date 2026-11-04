import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { browserSignInCallbackUrl, startChatGptSignIn } from './ai-settings';

const api = vi.hoisted(() => ({ native: false, start: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => api.native }));
vi.mock('./request', () => ({
  request: (invoke: (client: { 'auth.startSignIn': typeof api.start }) => Effect.Effect<unknown>) =>
    Effect.runPromise(invoke({ 'auth.startSignIn': api.start }))
}));
beforeEach(() => {
  api.native = false;
  api.start
    .mockReset()
    .mockReturnValue(Effect.succeed({ url: 'https://auth.example', attemptId: 'test' }));
});

for (const [origin, expected] of [
  ['http://localhost:5173', 'http://127.0.0.1:5173/auth/callback'],
  ['http://127.0.0.1:43891', 'http://127.0.0.1:43891/auth/callback'],
  ['http://[::1]:8080', 'http://127.0.0.1:8080/auth/callback'],
  ['http://localhost', 'http://127.0.0.1/auth/callback']
])
  testStable(`browser callback preserves the reachable port for ${origin}`, () => {
    expect(browserSignInCallbackUrl(origin!)).toBe(expected);
  });

for (const origin of ['https://host.example', 'http://192.168.1.2:5173', 'https://localhost:5173'])
  testStable(`unsupported browser origin fails before OAuth: ${origin}`, () => {
    expect(() => browserSignInCallbackUrl(origin)).toThrow(
      expect.objectContaining({ kind: 'unsupported' })
    );
  });

testStable('web sign-in supplies the browser callback endpoint', async () => {
  await startChatGptSignIn();
  expect(api.start).toHaveBeenCalledWith({
    callbackUrl: browserSignInCallbackUrl(window.location.origin)
  });
});

testStable('native sign-in keeps its local callback listener transport', async () => {
  api.native = true;
  await startChatGptSignIn();
  expect(api.start).toHaveBeenCalledWith({});
});
