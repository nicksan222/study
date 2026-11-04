/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises loopback OAuth sign-in with PKCE, callback validation, expiry, disposal, │
 * │ and localized failure pages. Local fetch peers make token and identity handling          │
 * │ deterministic.                                                                           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: PKCE sign-in verifies identity and returns the issued account; abandoned      │
 * │   sign-in expires and closes its listener.                                               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Starts #server/platform/ai/providers/chatgpt/signin against a local HTTP peer; the test  │
 * │ owns and closes that peer.                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { SignIn, acquireSignIn } from '#server/platform/ai/providers/chatgpt/signin';

testStable('PKCE sign-in verifies identity and returns the issued account', async () => {
  let nonce = '';
  const signIn = await SignIn.start({
    issuer: 'https://auth.example',
    hostId: 'host',
    fetch: async (_url, init) => {
      const form = new URLSearchParams(init?.body as string);

      assert.ok(form.get('grant_type') === 'authorization_code');
      assert.ok(form.get('code_verifier'));
      const claims = {
        iss: 'https://auth.example',
        aud: 'issued',
        sub: 'user',
        nonce,
        exp: Math.floor(Date.now() / 1000) + 60
      };

      return Response.json({
        access_token: 'access',
        refresh_token: 'refresh',
        scope: 'openid chatgpt.tokens.use.direct',
        id_token: `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
      });
    }
  });
  const url = new URL(signIn.url);

  nonce = url.searchParams.get('nonce')!;
  assert.ok(url.searchParams.get('code_challenge_method') === 'S256');
  const finish = signIn.finish(5000);
  const callback = new URL(url.searchParams.get('redirect_uri')!);

  callback.searchParams.set('state', url.searchParams.get('state')!);
  callback.searchParams.set('code', 'code');
  callback.searchParams.set('client_id', 'issued');
  assert.strictEqual((await fetch(callback)).status, 200);
  const result = await finish;

  assert.ok(result.account.subject === 'user');
  assert.ok(result.account.sharing === true);
  assert.ok(result.account.refreshToken === 'refresh');
});

testStable('abandoned sign-in expires and closes its listener', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const signIn = yield* acquireSignIn({
          issuer: 'https://auth.example',
          hostId: 'host',
          lifetimeMs: 20
        });
        const callback = new URL(new URL(signIn.url).searchParams.get('redirect_uri')!);

        yield* Effect.sleep(60);
        yield* Effect.promise(() => expect(fetch(callback)).rejects.toSatisfy(() => true));
        yield* Effect.promise(() => expect(signIn.finish(1000)).rejects.toThrow(/expired|cancel/i));
      })
    )
  );
});

testStable('disposing sign-in cancels a waiting finish and closes the listener', async () => {
  const signIn = await SignIn.start({
    issuer: 'https://auth.example',
    hostId: 'host'
  });
  const callback = new URL(new URL(signIn.url).searchParams.get('redirect_uri')!);
  const finishing = signIn.finish(5000);

  signIn.dispose();
  await expect(finishing).rejects.toThrow(/cancel/i);
  await expect(fetch(callback)).rejects.toSatisfy(() => true);
});

testStable('callback failure shows both localized messages', async () => {
  const signIn = await SignIn.start({
    issuer: 'https://auth.example',
    hostId: 'host'
  });
  const finishing = expect(signIn.finish(5000)).rejects.toThrow(/mismatch/i);
  const callback = new URL(new URL(signIn.url).searchParams.get('redirect_uri')!);
  const response = await fetch(callback);
  const page = await response.text();

  expect(page).toMatch(/The sign-in did not complete/);
  expect(page).toMatch(/accesso non è riuscito/);
  await finishing;
});

testStable('malformed token response and ID claims do not leak their contents', async () => {
  for (const body of [
    'secret-token-body',
    JSON.stringify({
      access_token: 'access',
      id_token: `e30.${Buffer.from('secret-identity').toString('base64url')}.sig`
    })
  ]) {
    const signIn = await SignIn.start({
      issuer: 'https://auth.example',
      hostId: 'host',
      clientId: 'issued',
      fetch: async () => new Response(body)
    });
    const url = new URL(signIn.url);
    const callback = new URL(url.searchParams.get('redirect_uri')!);

    callback.searchParams.set('state', url.searchParams.get('state')!);
    callback.searchParams.set('code', 'code');
    const failure = expect(signIn.finish(5000)).rejects.toSatisfy(
      (error) =>
        !String(error).includes('secret-token-body') &&
        !String(error).includes('secret-identity') &&
        error instanceof Error &&
        error.cause === undefined
    );

    await fetch(callback);
    await failure;
  }
});

testStable(
  'sign-in deadline interrupts a stalled loopback token body and releases both connections',
  async () => {
    const { createServer } = await import('node:http');
    const { Clock } = await import('effect');
    const { TestClock } = await import('effect/testing');
    let started!: () => void;
    let closed!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const bodyClosed = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const server = createServer((request, response) => {
      request.on('close', closed);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{');
      started();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    assert.ok(!(!address || typeof address === 'string'), 'No loopback address');

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const clock = yield* Clock.Clock;
          const signIn = yield* Effect.promise(() =>
            SignIn.start({
              issuer: `http://127.0.0.1:${address.port}`,
              hostId: 'host',
              clientId: 'client',
              clock
            })
          );
          const url = new URL(signIn.url);
          const callback = new URL(url.searchParams.get('redirect_uri')!);

          callback.searchParams.set('state', url.searchParams.get('state')!);
          callback.searchParams.set('code', 'code');
          const finishing = signIn.finish(5000);
          const rejected = expect(finishing).rejects.toThrow(/timed out/);

          yield* Effect.promise(() => fetch(callback));
          yield* Effect.promise(() => bodyStarted);
          yield* TestClock.adjust('5 seconds');
          yield* Effect.promise(() => rejected);
          yield* Effect.promise(() => bodyClosed);
          yield* Effect.promise(() => expect(fetch(callback)).rejects.toSatisfy(() => true));
        }).pipe(Effect.provide(TestClock.layer()))
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
);
