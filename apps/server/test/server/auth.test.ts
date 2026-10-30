import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { Appearance, Language, LlmProvider } from '@study/contracts/settings';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Fiber } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

function failureKind(error: unknown) {
  assert.ok(error && typeof error === 'object' && 'kind' in error);

  return error.kind;
}

function callback(address: string) {
  const authorization = new URL(address);
  const url = new URL(authorization.searchParams.get('redirect_uri')!);

  assert.equal(url.hostname, '127.0.0.1');
  url.searchParams.set('state', authorization.searchParams.get('state')!);

  return url;
}

async function listenerClosed(url: URL) {
  const socket = createConnection({ host: url.hostname, port: Number(url.port) });

  try {
    await assert.rejects(
      once(socket, 'connect', { signal: AbortSignal.timeout(2000) }),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED'
    );
  } finally {
    socket.destroy();
  }
}

async function fixture() {
  const location = createTestDatabase();
  let app = await App.open({ path: location.path });
  let server = await serve(app);

  return {
    get url() {
      return server.url;
    },
    async reopen() {
      await server.close();
      await app.close();
      app = await App.open({ path: location.path });
      server = await serve(app);
    },
    async close() {
      await server.close();
      await app.close();
      location.cleanup();
    }
  };
}

test('ChatGPT sign-in opens a real loopback callback with PKCE and can be cancelled', async () => {
  const f = await fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
          const attempt = yield* client['auth.startSignIn']({});
          const url = new URL(attempt.url);

          assert.equal(url.origin, 'https://auth.openai.com');
          assert.equal(url.pathname, '/api/accounts/authorize');
          assert.ok(attempt.attemptId);
          assert.equal(url.searchParams.get('code_challenge_method'), 'S256');

          for (const key of ['state', 'nonce', 'code_challenge'])
            assert.match(url.searchParams.get(key)!, /^[A-Za-z0-9_-]{43}$/);

          const redirect = callback(attempt.url);
          const response = yield* Effect.promise(() => fetch(new URL('/unknown', redirect)));

          assert.equal(response.status, 404);
          yield* Effect.promise(() => response.arrayBuffer());
          assert.equal(yield* client['auth.publicAccount']({}), undefined);
          assert.equal(yield* client['auth.cancelSignIn']({ attemptId: attempt.attemptId }), true);
          yield* Effect.promise(() => listenerClosed(redirect));
          assert.deepEqual(yield* client['auth.status']({}), {
            signedIn: false,
            email: null,
            sharing: false
          });
        })
      )
    );
  } finally {
    await f.close();
  }
});

test('duplicate finish rejects while the admitted sign-in still awaits its callback', async () => {
  const f = await fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
          const attempt = yield* client['auth.startSignIn']({});
          const first = yield* Effect.forkChild(
            Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
          );

          yield* Effect.sleep('100 millis');
          assert.equal(
            failureKind(
              yield* Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
            ),
            'invalid_input'
          );
          const redirect = callback(attempt.url);
          const alive = yield* Effect.promise(() => fetch(new URL('/unknown', redirect)));

          assert.equal(alive.status, 404);
          yield* Effect.promise(() => alive.arrayBuffer());
          redirect.searchParams.set('error', 'access_denied');
          const response = yield* Effect.promise(() => fetch(redirect));

          assert.equal(response.status, 400);
          yield* Effect.promise(() => response.text());
          assert.ok(yield* Fiber.join(first));
          yield* Effect.promise(() => listenerClosed(redirect));
          assert.equal(yield* client['auth.publicAccount']({}), undefined);
        })
      )
    );
  } finally {
    await f.close();
  }
});

test('cancel rejects a pending finish and cannot leave credentials behind', async () => {
  const f = await fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
          const attempt = yield* client['auth.startSignIn']({});
          const pending = yield* Effect.forkChild(
            Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
          );

          yield* Effect.sleep('100 millis');
          assert.equal(yield* client['auth.cancelSignIn']({ attemptId: attempt.attemptId }), true);
          assert.equal(failureKind(yield* Fiber.join(pending)), 'cancelled');
          assert.equal(yield* client['auth.cancelSignIn']({ attemptId: attempt.attemptId }), false);
          yield* Effect.promise(() => listenerClosed(callback(attempt.url)));
        })
      )
    );
    await f.reopen();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });

          assert.equal(yield* client['auth.publicAccount']({}), undefined);
        })
      )
    );
  } finally {
    await f.close();
  }
});

test('interrupting an HTTP finish closes its callback listener', async () => {
  const f = await fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
          const attempt = yield* client['auth.startSignIn']({});
          const pending = yield* Effect.forkChild(
            client['auth.finishSignIn']({ attemptId: attempt.attemptId })
          );

          yield* Effect.sleep('100 millis');
          assert.equal(
            failureKind(
              yield* Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
            ),
            'invalid_input'
          );
          const redirect = callback(attempt.url);
          const socket = createConnection({ host: redirect.hostname, port: Number(redirect.port) });

          yield* Effect.promise(() =>
            once(socket, 'connect', { signal: AbortSignal.timeout(2000) })
          );
          const closed = once(socket, 'close', { signal: AbortSignal.timeout(2000) });

          yield* Fiber.interrupt(pending);
          yield* Effect.promise(() => closed);
          yield* Effect.promise(() => listenerClosed(redirect));
          assert.equal(yield* client['auth.publicAccount']({}), undefined);
        })
      )
    );
    await f.reopen();
  } finally {
    await f.close();
  }
});

test('stale attempt IDs cannot finish or cancel a replacement sign-in', async () => {
  const f = await fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
          const old = yield* client['auth.startSignIn']({});
          const current = yield* client['auth.startSignIn']({ reconsent: true });

          assert.notEqual(current.attemptId, old.attemptId);
          assert.equal(new URL(current.url).searchParams.get('force_reconsent'), 'true');
          yield* Effect.promise(() => listenerClosed(callback(old.url)));
          assert.equal(
            failureKind(
              yield* Effect.flip(client['auth.finishSignIn']({ attemptId: old.attemptId }))
            ),
            'invalid_input'
          );
          assert.equal(yield* client['auth.cancelSignIn']({ attemptId: old.attemptId }), false);
          const alive = yield* Effect.promise(() =>
            fetch(new URL('/unknown', callback(current.url)))
          );

          assert.equal(alive.status, 404);
          yield* Effect.promise(() => alive.arrayBuffer());
          assert.equal(yield* client['auth.cancelSignIn']({ attemptId: current.attemptId }), true);
          yield* Effect.promise(() => listenerClosed(callback(current.url)));
          assert.equal(yield* client['auth.publicAccount']({}), undefined);
        })
      )
    );
  } finally {
    await f.close();
  }
});

test('a mismatched callback state rejects sign-in without saving an account', async () => {
  const f = await fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
          const attempt = yield* client['auth.startSignIn']({});
          const pending = yield* Effect.forkChild(
            Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
          );
          const redirect = callback(attempt.url);

          redirect.searchParams.set('state', 'incorrect-state');
          const response = yield* Effect.promise(() => fetch(redirect));

          assert.equal(response.status, 400);
          yield* Effect.promise(() => response.text());
          assert.ok(yield* Fiber.join(pending));
          yield* Effect.promise(() => listenerClosed(redirect));
        })
      )
    );
    await f.reopen();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });

          assert.equal(yield* client['auth.publicAccount']({}), undefined);
        })
      )
    );
  } finally {
    await f.close();
  }
});

test('sign-out cancels admission and preserves default and saved preferences across reopen', async () => {
  const f = await fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });

          assert.deepEqual(yield* client['auth.status']({}), {
            signedIn: false,
            email: null,
            sharing: false
          });
          const defaults = yield* client['settings.appSettings']({});

          assert.deepEqual(defaults, {
            language: Language.ENGLISH,
            appearance: Appearance.DARK,
            zoomPercent: 100,
            onboarded: false
          });
          const llm = yield* client['settings.llmSettings']({});

          for (const tier of [llm.tiny, llm.medium, llm.smart]) {
            assert.equal(tier?.provider, LlmProvider.CHAT_GPT);
            assert.equal(tier?.model, undefined);
          }

          assert.equal((yield* client['settings.reviewSettings']({})).newCardsPerDay, 20);
          assert.equal((yield* client['settings.materialSettings']({})).sift, true);
          yield* client['auth.signOut']({});
          yield* Effect.promise(() => f.reopen());
          client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
          assert.deepEqual(yield* client['settings.appSettings']({}), defaults);
          assert.deepEqual(yield* client['settings.llmSettings']({}), llm);
          assert.equal((yield* client['settings.reviewSettings']({})).newCardsPerDay, 20);
          assert.equal((yield* client['settings.materialSettings']({})).sift, true);
          const saved = {
            language: Language.ITALIAN,
            appearance: Appearance.LIGHT,
            zoomPercent: 125,
            onboarded: true
          };

          yield* client['settings.saveAppSettings'](saved);
          yield* client['settings.saveReviewSettings']({ newCardsPerDay: 35 });
          yield* client['settings.saveMaterialSettings']({ sift: false });
          const project = yield* client['projects.createProject']({ name: 'Physics' });
          const attempt = yield* client['auth.startSignIn']({});
          const pending = yield* Effect.forkChild(
            Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
          );

          yield* Effect.sleep('100 millis');
          yield* client['auth.signOut']({});
          assert.equal(failureKind(yield* Fiber.join(pending)), 'cancelled');
          yield* Effect.promise(() => listenerClosed(callback(attempt.url)));
          yield* Effect.promise(() => f.reopen());
          client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
          assert.equal(yield* client['auth.publicAccount']({}), undefined);
          assert.equal(
            (yield* client['projects.projects']({ limit: 20 })).items[0]?.id,
            project.id
          );
          assert.deepEqual(yield* client['settings.appSettings']({}), saved);
          assert.equal((yield* client['settings.reviewSettings']({})).newCardsPerDay, 35);
          assert.equal((yield* client['settings.materialSettings']({})).sift, false);
        })
      )
    );
  } finally {
    await f.close();
  }
});

test('application shutdown closes an unfinished sign-in callback', async () => {
  const f = await fixture();
  let redirect: URL | undefined;

  try {
    redirect = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
          const attempt = yield* client['auth.startSignIn']({});

          return callback(attempt.url);
        })
      )
    );
  } finally {
    await f.close();
  }

  await listenerClosed(redirect);
});
