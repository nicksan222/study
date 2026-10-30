import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Effect } from 'effect';

import { SignIn, acquireSignIn } from '#server/platform/ai/providers/chatgpt/signin';

test('PKCE sign-in verifies identity and returns the issued account', async () => {
  let nonce = '';
  const signIn = await SignIn.start({
    issuer: 'https://auth.example',
    hostId: 'host',
    fetch: async (_url, init) => {
      const form = new URLSearchParams(init?.body as string);

      assert.equal(form.get('grant_type'), 'authorization_code');
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
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const finish = signIn.finish(5000);
  const callback = new URL(url.searchParams.get('redirect_uri')!);

  callback.searchParams.set('state', url.searchParams.get('state')!);
  callback.searchParams.set('code', 'code');
  callback.searchParams.set('client_id', 'issued');
  assert.equal((await fetch(callback)).status, 200);
  const result = await finish;

  assert.equal(result.account.subject, 'user');
  assert.equal(result.account.sharing, true);
  assert.equal(result.account.refreshToken, 'refresh');
});

test('abandoned sign-in expires and closes its listener', async () => {
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
        yield* Effect.promise(() => assert.rejects(fetch(callback)));
        yield* Effect.promise(() => assert.rejects(signIn.finish(1000), /expired|cancel/i));
      })
    )
  );
});

test('disposing sign-in cancels a waiting finish and closes the listener', async () => {
  const signIn = await SignIn.start({
    issuer: 'https://auth.example',
    hostId: 'host'
  });
  const callback = new URL(new URL(signIn.url).searchParams.get('redirect_uri')!);
  const finishing = signIn.finish(5000);

  signIn.dispose();
  await assert.rejects(finishing, /cancel/i);
  await assert.rejects(fetch(callback));
});

test('callback failure shows both localized messages', async () => {
  const signIn = await SignIn.start({
    issuer: 'https://auth.example',
    hostId: 'host'
  });
  const finishing = assert.rejects(signIn.finish(5000), /mismatch/i);
  const callback = new URL(new URL(signIn.url).searchParams.get('redirect_uri')!);
  const response = await fetch(callback);
  const page = await response.text();

  assert.match(page, /The sign-in did not complete/);
  assert.match(page, /accesso non è riuscito/);
  await finishing;
});

test('malformed token response and ID claims do not leak their contents', async () => {
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
    const failure = assert.rejects(
      signIn.finish(5000),
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

test('sign-in deadline interrupts a stalled loopback token body and releases both connections', async () => {
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

  if (!address || typeof address === 'string') throw new Error('No loopback address');

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
        const rejected = assert.rejects(finishing, /timed out/);

        yield* Effect.promise(() => fetch(callback));
        yield* Effect.promise(() => bodyStarted);
        yield* TestClock.adjust('5 seconds');
        yield* Effect.promise(() => rejected);
        yield* Effect.promise(() => bodyClosed);
        yield* Effect.promise(() => assert.rejects(fetch(callback)));
      }).pipe(Effect.provide(TestClock.layer()))
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
