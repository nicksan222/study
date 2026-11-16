import { StudyRpc } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises ChatGPT authentication over real server RPC, including loopback PKCE     │
 * │ callbacks, cancellation, and persistence across application reopen. It also covers       │
 * │ request serialization and durable credential rotation.                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: ChatGPT sign-in opens a real loopback callback with PKCE and can be           │
 * │   cancelled; duplicate finish rejects while the admitted sign-in still awaits its        │
 * │   callback.                                                                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/runtime/index with real SQLite and application        │
 * │ resources; fixture cleanup closes owned resources.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { Appearance, Language, LlmProvider } from '@study/contracts';
import { test } from '@study/testing';
import { Effect, Fiber } from 'effect';

import { makeStudyClient } from '#server/client/index';

function failureKind(error: unknown) {
  test.assert.ok(error && typeof error === 'object' && 'kind' in error);

  return error.kind;
}

function callback(address: string) {
  const authorization = new URL(address);
  const url = new URL(authorization.searchParams.get('redirect_uri')!);

  test.assert.ok(url.hostname === '127.0.0.1');
  url.searchParams.set('state', authorization.searchParams.get('state')!);

  return url;
}

async function listenerClosed(url: URL) {
  await test
    .expect(
      Bun.connect({
        hostname: url.hostname,
        port: Number(url.port),
        socket: { data() {} }
      })
    )
    .rejects.toSatisfy(
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED'
    );
}

async function waitForSocketEvent(event: Promise<void>) {
  await test.withinTestDeadline(event);
}

test.stable(
  'ChatGPT sign-in opens a real loopback callback with PKCE and can be cancelled',
  async ({ rpc }) => {
    try {
      await rpc.runPromise(
        Effect.gen(function* () {
          const client = rpc.client;
          const attempt = yield* client['auth.startSignIn']({});
          const url = new URL(attempt.url);

          test.assert.ok(url.origin === 'https://auth.openai.com');
          test.assert.ok(url.pathname === '/api/accounts/authorize');
          test.assert.ok(attempt.attemptId);
          test.assert.ok(url.searchParams.get('code_challenge_method') === 'S256');

          for (const key of ['state', 'nonce', 'code_challenge'])
            test.expect(url.searchParams.get(key)!).toMatch(/^[A-Za-z0-9_-]{43}$/);

          const redirect = callback(attempt.url);
          const response = yield* Effect.promise(() => fetch(new URL('/unknown', redirect)));

          test.assert.strictEqual(response.status, 404);
          yield* Effect.promise(() => response.arrayBuffer());
          test.assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
          test.assert.strictEqual(
            yield* client['auth.cancelSignIn']({ attemptId: attempt.attemptId }),
            true
          );
          yield* Effect.promise(() => listenerClosed(redirect));
          test.expect(yield* client['auth.status']({})).toStrictEqual({
            signedIn: false,
            email: null,
            sharing: false
          });
        })
      );
    } finally {
      await rpc.close();
    }
  }
);

test.stable(
  'duplicate finish rejects while the admitted sign-in still awaits its callback',
  async ({ rpc }) => {
    try {
      await rpc.runPromise(
        Effect.gen(function* () {
          const client = rpc.client;
          const attempt = yield* client['auth.startSignIn']({});
          const first = yield* Effect.forkChild(
            Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
          );

          yield* Effect.sleep('100 millis');
          test.assert.ok(
            failureKind(
              yield* Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
            ) === 'invalid_input'
          );
          const redirect = callback(attempt.url);
          const alive = yield* Effect.promise(() => fetch(new URL('/unknown', redirect)));

          test.assert.strictEqual(alive.status, 404);
          yield* Effect.promise(() => alive.arrayBuffer());
          redirect.searchParams.set('error', 'access_denied');
          const response = yield* Effect.promise(() => fetch(redirect));

          test.assert.strictEqual(response.status, 400);
          yield* Effect.promise(() => response.text());
          test.assert.ok(yield* Fiber.join(first));
          yield* Effect.promise(() => listenerClosed(redirect));
          test.assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
        })
      );
    } finally {
      await rpc.close();
    }
  }
);

test.stable(
  'cancel rejects a pending finish and cannot leave credentials behind',
  async ({ rpc }) => {
    try {
      await rpc.runPromise(
        Effect.gen(function* () {
          const client = rpc.client;
          const attempt = yield* client['auth.startSignIn']({});
          const pending = yield* Effect.forkChild(
            Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
          );

          yield* Effect.sleep('100 millis');
          test.assert.strictEqual(
            yield* client['auth.cancelSignIn']({ attemptId: attempt.attemptId }),
            true
          );
          test.assert.ok(failureKind(yield* Fiber.join(pending)) === 'cancelled');
          test.assert.strictEqual(
            yield* client['auth.cancelSignIn']({ attemptId: attempt.attemptId }),
            false
          );
          yield* Effect.promise(() => listenerClosed(callback(attempt.url)));
        })
      );
      await rpc.reopen();
      await rpc.runPromise(
        Effect.gen(function* () {
          const client = rpc.client;

          test.assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
        })
      );
    } finally {
      await rpc.close();
    }
  }
);

test.stable('interrupting an HTTP finish closes its callback listener', async ({ rpc }) => {
  try {
    await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;
        const attempt = yield* client['auth.startSignIn']({});
        const pending = yield* Effect.forkChild(
          client['auth.finishSignIn']({ attemptId: attempt.attemptId })
        );

        yield* Effect.sleep('100 millis');
        test.assert.ok(
          failureKind(
            yield* Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
          ) === 'invalid_input'
        );
        const redirect = callback(attempt.url);
        let onAccepted!: () => void;
        const accepted = new Promise<void>((resolve) => {
          onAccepted = resolve;
        });
        let onClose!: () => void;
        const closed = new Promise<void>((resolve) => {
          onClose = resolve;
        });
        const socket = yield* Effect.promise(() =>
          Bun.connect({
            hostname: redirect.hostname,
            port: Number(redirect.port),
            socket: {
              open(connection) {
                connection.write('GET /unknown HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
              },
              data() {
                onAccepted();
              },
              close() {
                onClose();
              }
            }
          })
        );

        // A response proves this same keep-alive connection was accepted before cancellation.
        yield* Effect.promise(() => waitForSocketEvent(accepted));
        socket.write('GET /auth/callback HTTP/1.1\r\nHost: 127.0.0.1\r\n');
        yield* Fiber.interrupt(pending);
        yield* Effect.promise(() => waitForSocketEvent(closed));
        socket.end();
        yield* Effect.promise(() => listenerClosed(redirect));
        test.assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
      })
    );
    await rpc.reopen();
  } finally {
    await rpc.close();
  }
});

test.stable('stale attempt IDs cannot finish or cancel a replacement sign-in', async ({ rpc }) => {
  try {
    await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;
        const old = yield* client['auth.startSignIn']({});
        const current = yield* client['auth.startSignIn']({ reconsent: true });

        test.assert.notStrictEqual(current.attemptId, old.attemptId);
        test.assert.ok(new URL(current.url).searchParams.get('force_reconsent') === 'true');
        yield* Effect.promise(() => listenerClosed(callback(old.url)));
        test.assert.ok(
          failureKind(
            yield* Effect.flip(client['auth.finishSignIn']({ attemptId: old.attemptId }))
          ) === 'invalid_input'
        );
        test.assert.strictEqual(
          yield* client['auth.cancelSignIn']({ attemptId: old.attemptId }),
          false
        );
        const alive = yield* Effect.promise(() =>
          fetch(new URL('/unknown', callback(current.url)))
        );

        test.assert.strictEqual(alive.status, 404);
        yield* Effect.promise(() => alive.arrayBuffer());
        test.assert.strictEqual(
          yield* client['auth.cancelSignIn']({ attemptId: current.attemptId }),
          true
        );
        yield* Effect.promise(() => listenerClosed(callback(current.url)));
        test.assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
      })
    );
  } finally {
    await rpc.close();
  }
});

test.stable(
  'a mismatched callback state rejects sign-in without saving an account',
  async ({ rpc }) => {
    try {
      await rpc.runPromise(
        Effect.gen(function* () {
          const client = rpc.client;
          const attempt = yield* client['auth.startSignIn']({});
          const pending = yield* Effect.forkChild(
            Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
          );
          const redirect = callback(attempt.url);

          redirect.searchParams.set('state', 'incorrect-state');
          const response = yield* Effect.promise(() => fetch(redirect));

          test.assert.strictEqual(response.status, 400);
          yield* Effect.promise(() => response.text());
          test.assert.ok(yield* Fiber.join(pending));
          yield* Effect.promise(() => listenerClosed(redirect));
        })
      );
      await rpc.reopen();
      await rpc.runPromise(
        Effect.gen(function* () {
          const client = rpc.client;

          test.assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
        })
      );
    } finally {
      await rpc.close();
    }
  }
);

test.stable(
  'sign-out cancels admission and preserves default and saved preferences across reopen',
  async ({ rpc }) => {
    try {
      const { defaults, llm } = await rpc.runPromise(
        Effect.gen(function* () {
          const client = rpc.client;

          test.expect(yield* client['auth.status']({})).toStrictEqual({
            signedIn: false,
            email: null,
            sharing: false
          });
          const defaults = yield* client['settings.appSettings']({});

          test.expect(defaults).toStrictEqual({
            language: Language.ENGLISH,
            appearance: Appearance.DARK,
            zoomPercent: 100,
            onboarded: false
          });
          const llm = yield* client['settings.llmSettings']({});

          for (const tier of [llm.tiny, llm.medium, llm.smart]) {
            test.assert.strictEqual(tier?.provider, LlmProvider.CHAT_GPT);
            test.assert.strictEqual(tier?.model, undefined);
          }

          test.assert.strictEqual(
            (yield* client['settings.reviewSettings']({})).newCardsPerDay,
            20
          );
          test.assert.ok((yield* client['settings.materialSettings']({})).sift === true);
          yield* client['auth.signOut']({});

          return { defaults, llm };
        })
      );

      await rpc.reopen();

      const { project, saved } = await rpc.runPromise(
        Effect.gen(function* () {
          const client = rpc.client;

          test.expect(yield* client['settings.appSettings']({})).toStrictEqual(defaults);
          test.expect(yield* client['settings.llmSettings']({})).toStrictEqual(llm);
          test.assert.strictEqual(
            (yield* client['settings.reviewSettings']({})).newCardsPerDay,
            20
          );
          test.assert.ok((yield* client['settings.materialSettings']({})).sift === true);
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
          test.assert.ok(failureKind(yield* Fiber.join(pending)) === 'cancelled');
          yield* Effect.promise(() => listenerClosed(callback(attempt.url)));

          return { project, saved };
        })
      );

      await rpc.reopen();

      await rpc.runPromise(
        Effect.gen(function* () {
          const client = rpc.client;

          test.assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
          test.assert.strictEqual(
            (yield* client['projects.projects']({ limit: 20 })).items[0]?.id,
            project.id
          );
          test.expect(yield* client['settings.appSettings']({})).toStrictEqual(saved);
          test.assert.strictEqual(
            (yield* client['settings.reviewSettings']({})).newCardsPerDay,
            35
          );
          test.assert.ok((yield* client['settings.materialSettings']({})).sift === false);
        })
      );
    } finally {
      await rpc.close();
    }
  }
);

test.stable('application shutdown closes an unfinished sign-in callback', async ({ rpc }) => {
  let redirect: URL | undefined;

  try {
    redirect = await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;
        const attempt = yield* client['auth.startSignIn']({});

        return callback(attempt.url);
      })
    );
  } finally {
    await rpc.app.close();
    await rpc.close();
  }

  await listenerClosed(redirect);
});

test.stable(
  'ChatGPT host identity is valid, distinct, and survives server restart',
  async ({ endpoints }) => {
    const first = await endpoints();
    let hostId: string | null = null;
    const start = (baseUrl: string) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl });
            const attempt = yield* client['auth.startSignIn']({});
            const hostId = new URL(attempt.url).searchParams.get('ext_agent_host_id');

            yield* client['auth.cancelSignIn']({ attemptId: attempt.attemptId });

            return hostId;
          })
        )
      );

    hostId = await start(first.url);
    test
      .expect(hostId)
      .toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    test.expect(await start(first.url)).toBe(hostId);
    await first.reopen();
    test.expect(await start(first.url)).toBe(hostId);
    await first.close();
    const second = await endpoints();

    test.expect(await start(second.url)).not.toBe(hostId);
  }
);
