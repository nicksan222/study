import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SignIn } from '../src/providers/chatgpt/signin.ts';

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
  const signIn = await SignIn.start({
    issuer: 'https://auth.example',
    hostId: 'host',
    lifetimeMs: 20
  });
  const callback = new URL(new URL(signIn.url).searchParams.get('redirect_uri')!);

  await new Promise((resolve) => setTimeout(resolve, 60));
  await assert.rejects(fetch(callback));
  await assert.rejects(signIn.finish(1000), /expired|cancel/i);
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
