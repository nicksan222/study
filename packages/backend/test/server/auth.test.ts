import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { test } from 'node:test';
import type { TestContext } from 'node:test';

import { createStudyClient } from '@study/backend/node';
import { Appearance, Language, LlmProvider } from '@study/backend/shared/settings';
import { TRPCClientError } from '@trpc/client';

import { readAppSettings } from '#backend/procedures/settings/operations/get-app-settings';
import { loadPreferences as opLoadPreferences } from '#backend/procedures/settings/preferences';
import { serve } from '#backend/runtime/server';
import { App } from '#backend/runtime/service';
import { createBackendTest } from '#testing/backend-test';

async function newDb(t: TestContext) {
  const testDatabase = createBackendTest(t, { app: false });
  const path = testDatabase.path;
  let app = createBackendTest(t, { app: false }).manage(await App.open({ path }));

  let server = createBackendTest(t, { app: false }).manage(await serve(app));

  return {
    get app() {
      return app;
    },
    get client() {
      return createStudyClient({ baseUrl: server.url });
    },
    async reopen() {
      await server.close();
      await app.close();
      app = createBackendTest(t, { app: false }).manage(await App.open({ path }));
      server = createBackendTest(t, { app: false }).manage(await serve(app));
    }
  };
}

const hasCode = (code: string) => (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === code;

function callback(address: string) {
  const authorization = new URL(address);
  const url = new URL(authorization.searchParams.get('redirect_uri')!);

  assert.equal(url.hostname, '127.0.0.1');
  url.searchParams.set('state', authorization.searchParams.get('state')!);

  return url;
}

function signedOut(app: App) {
  assert.deepEqual(app.signInStatus(), {
    signedIn: false,
    email: null,
    sharing: false
  });
  assert.equal(app.publicAccount(), undefined);
  assert.deepEqual(opLoadPreferences(app.store, 'private.chatgpt'), {});
}

async function listenerClosed(url: URL) {
  const socket = createConnection({
    host: url.hostname,
    port: Number(url.port)
  });

  try {
    await assert.rejects(
      once(socket, 'connect', { signal: AbortSignal.timeout(2000) }),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED'
    );
  } finally {
    socket.destroy();
  }
}

test('ChatGPT sign-in opens a real loopback callback with PKCE and can be cancelled', async (t) => {
  const f = await newDb(t);
  const attempt = await f.client.auth.startChatgptSignIn.mutate({});
  const url = new URL(attempt.url);

  assert.equal(url.origin, 'https://auth.openai.com');
  assert.equal(url.pathname, '/api/accounts/authorize');
  assert.ok(attempt.attemptId);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');

  for (const key of ['state', 'nonce', 'code_challenge'])
    assert.match(url.searchParams.get(key)!, /^[A-Za-z0-9_-]{43}$/);

  const redirect = callback(attempt.url);
  const response = await fetch(new URL('/unknown', redirect));

  assert.equal(response.status, 404);
  await response.arrayBuffer();
  assert.equal((await f.client.auth.connections.query({})).chatgpt, undefined);
  assert.equal(
    (
      await f.client.auth.cancelChatgptSignIn.mutate({
        attemptId: attempt.attemptId
      })
    ).value,
    true
  );
  await listenerClosed(redirect);
  signedOut(f.app);
});

test('duplicate finish rejects while the admitted sign-in still awaits its callback', async (t) => {
  const f = await newDb(t);
  const attempt = await f.client.auth.startChatgptSignIn.mutate({});
  // The service admits synchronously, so the duplicate RPC cannot win a scheduling race.
  const first = assert.rejects(f.app.finishSignIn(undefined, attempt.attemptId), {
    message: 'Sign-in declined'
  });

  await assert.rejects(
    f.client.auth.finishChatgptSignIn.mutate({ attemptId: attempt.attemptId }),
    hasCode('BAD_REQUEST')
  );
  const redirect = callback(attempt.url);
  const alive = await fetch(new URL('/unknown', redirect));

  assert.equal(alive.status, 404);
  await alive.arrayBuffer();
  redirect.searchParams.set('error', 'access_denied');
  const response = await fetch(redirect);

  assert.equal(response.status, 400);
  await response.text();
  await first;
  await listenerClosed(redirect);
  signedOut(f.app);
});

test('cancel rejects a pending finish and cannot leave credentials behind', async (t) => {
  const f = await newDb(t);
  const attempt = await f.client.auth.startChatgptSignIn.mutate({});
  const pending = assert.rejects(f.app.finishSignIn(undefined, attempt.attemptId), {
    message: 'Sign-in cancelled'
  });

  assert.equal(
    (
      await f.client.auth.cancelChatgptSignIn.mutate({
        attemptId: attempt.attemptId
      })
    ).value,
    true
  );
  await pending;
  assert.equal(
    (
      await f.client.auth.cancelChatgptSignIn.mutate({
        attemptId: attempt.attemptId
      })
    ).value,
    false
  );
  await listenerClosed(callback(attempt.url));
  await f.reopen();
  signedOut(f.app);
});

test('disconnecting a real tRPC finish aborts the pending callback admission', async (t) => {
  const f = await newDb(t);
  const attempt = await f.client.auth.startChatgptSignIn.mutate({});
  const controller = new AbortController();
  const client = f.client;
  const pending = assert.rejects(
    client.auth.finishChatgptSignIn.mutate(
      { attemptId: attempt.attemptId },
      { signal: controller.signal }
    ),
    (error: unknown) => error instanceof Error && controller.signal.aborted
  );

  // A rejected duplicate proves that the first transport request reached admission.
  await assert.rejects(
    client.auth.finishChatgptSignIn.mutate(
      { attemptId: attempt.attemptId },
      { signal: AbortSignal.timeout(2000) }
    ),
    hasCode('BAD_REQUEST')
  );
  const redirect = callback(attempt.url);
  const socket = createConnection({
    host: redirect.hostname,
    port: Number(redirect.port)
  });

  createBackendTest(t, { app: false }).dispose(() => {
    socket.destroy();
  });
  await once(socket, 'connect', { signal: AbortSignal.timeout(2000) });
  const closed = once(socket, 'close', { signal: AbortSignal.timeout(2000) });

  controller.abort();
  await pending;
  // The callback socket must close before server/app cleanup can cancel anything.
  await closed;
  assert.equal(socket.destroyed, true);
  await listenerClosed(redirect);
  signedOut(f.app);
  await f.reopen();
  signedOut(f.app);
});

test('stale attempt IDs cannot finish or cancel a replacement sign-in', async (t) => {
  const f = await newDb(t);
  const old = await f.client.auth.startChatgptSignIn.mutate({});
  const current = await f.client.auth.startChatgptSignIn.mutate({
    reconsent: true
  });

  assert.notEqual(current.attemptId, old.attemptId);
  assert.equal(new URL(current.url).searchParams.get('force_reconsent'), 'true');
  await listenerClosed(callback(old.url));
  await assert.rejects(
    f.client.auth.finishChatgptSignIn.mutate({ attemptId: old.attemptId }),
    hasCode('BAD_REQUEST')
  );
  assert.equal(
    (
      await f.client.auth.cancelChatgptSignIn.mutate({
        attemptId: old.attemptId
      })
    ).value,
    false
  );
  const pending = assert.rejects(f.app.finishSignIn(undefined, current.attemptId));
  const alive = await fetch(new URL('/unknown', callback(current.url)));

  assert.equal(alive.status, 404);
  await alive.arrayBuffer();
  assert.equal(
    (
      await f.client.auth.cancelChatgptSignIn.mutate({
        attemptId: current.attemptId
      })
    ).value,
    true
  );
  await pending;
  await listenerClosed(callback(current.url));
  signedOut(f.app);
});

test('a mismatched callback state rejects sign-in without saving an account', async (t) => {
  const f = await newDb(t);
  const attempt = await f.client.auth.startChatgptSignIn.mutate({});
  const pending = assert.rejects(f.app.finishSignIn(undefined, attempt.attemptId), {
    message: 'Sign-in state mismatch'
  });
  const redirect = callback(attempt.url);

  redirect.searchParams.set('state', 'incorrect-state');
  const response = await fetch(redirect);

  assert.equal(response.status, 400);
  await response.text();
  await pending;
  await listenerClosed(redirect);
  await f.reopen();
  signedOut(f.app);
});

test('sign-out cancels admission and preserves default and saved preferences across reopen', async (t) => {
  const f = await newDb(t);

  signedOut(f.app);
  const defaults = await f.client.settings.getAppSettings.query({});

  assert.equal(defaults.language, Language.ENGLISH);
  assert.equal(defaults.appearance, Appearance.DARK);
  assert.equal(defaults.zoomPercent, 100);
  assert.equal(defaults.onboarded, false);
  const llm = await f.client.settings.getLlmSettings.query({});

  for (const tier of [llm.tiny, llm.medium, llm.smart]) {
    assert.equal(tier?.provider, LlmProvider.CHAT_GPT);
    assert.equal(tier?.model, undefined);
  }

  assert.equal((await f.client.settings.getReviewSettings.query({})).newCardsPerDay, 20);
  assert.equal((await f.client.settings.getMaterialSettings.query({})).sift, true);
  await f.client.auth.signOutChatgpt.mutate({});
  await f.reopen();
  assert.deepEqual(await f.client.settings.getAppSettings.query({}), defaults);
  assert.deepEqual(await f.client.settings.getLlmSettings.query({}), llm);
  assert.equal((await f.client.settings.getReviewSettings.query({})).newCardsPerDay, 20);
  assert.equal((await f.client.settings.getMaterialSettings.query({})).sift, true);
  const saved = {
    language: Language.ITALIAN,
    appearance: Appearance.LIGHT,
    zoomPercent: 125,
    onboarded: true
  };

  await f.client.settings.saveAppSettings.mutate(saved);
  await f.client.settings.saveReviewSettings.mutate({ newCardsPerDay: 35 });
  await f.client.settings.saveMaterialSettings.mutate({ sift: false });
  const project = await f.client.projects.createProject.mutate({
    name: 'Physics'
  });
  const attempt = await f.client.auth.startChatgptSignIn.mutate({});
  const pending = assert.rejects(f.app.finishSignIn(undefined, attempt.attemptId));

  await f.client.auth.signOutChatgpt.mutate({});
  await pending;
  await listenerClosed(callback(attempt.url));
  await f.reopen();
  signedOut(f.app);
  assert.equal((await f.client.auth.connections.query({})).chatgpt, undefined);
  assert.equal((await f.client.projects.projects.query({})).items[0]?.id, project.id);
  assert.equal(readAppSettings(f.app.store).language, saved.language);
  assert.deepEqual(readAppSettings(f.app.store), saved);
  assert.equal((await f.client.settings.getReviewSettings.query({})).newCardsPerDay, 35);
  assert.equal((await f.client.settings.getMaterialSettings.query({})).sift, false);
});
