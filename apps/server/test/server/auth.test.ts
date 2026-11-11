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

import { StudyRpc } from '@study/contracts/rpc';
import { Appearance, Language, LlmProvider } from '@study/contracts/settings';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Fiber } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

function failureKind(error: unknown) {
  assert.ok(error && typeof error === 'object' && 'kind' in error);

  return error.kind;
}

function callback(address: string) {
  const authorization = new URL(address);
  const url = new URL(authorization.searchParams.get('redirect_uri')!);

  assert.ok(url.hostname === '127.0.0.1');
  url.searchParams.set('state', authorization.searchParams.get('state')!);

  return url;
}

async function listenerClosed(url: URL) {
  await expect(
    Bun.connect({
      hostname: url.hostname,
      port: Number(url.port),
      socket: { data() {} }
    })
  ).rejects.toSatisfy(
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED'
  );
}

async function waitForClose(closed: Promise<void>) {
  await Promise.race([
    closed,
    Bun.sleep(2000).then(() => {
      throw new Error('Socket did not close');
    })
  ]);
}

async function fixture() {
  const location = await createTestDatabase();
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
      await location.cleanup();
    }
  };
}

testStable(
  'ChatGPT sign-in opens a real loopback callback with PKCE and can be cancelled',
  async () => {
    const f = await fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
            const attempt = yield* client['auth.startSignIn']({});
            const url = new URL(attempt.url);

            assert.ok(url.origin === 'https://auth.openai.com');
            assert.ok(url.pathname === '/api/accounts/authorize');
            assert.ok(attempt.attemptId);
            assert.ok(url.searchParams.get('code_challenge_method') === 'S256');

            for (const key of ['state', 'nonce', 'code_challenge'])
              expect(url.searchParams.get(key)!).toMatch(/^[A-Za-z0-9_-]{43}$/);

            const redirect = callback(attempt.url);
            const response = yield* Effect.promise(() => fetch(new URL('/unknown', redirect)));

            assert.strictEqual(response.status, 404);
            yield* Effect.promise(() => response.arrayBuffer());
            assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
            assert.strictEqual(
              yield* client['auth.cancelSignIn']({ attemptId: attempt.attemptId }),
              true
            );
            yield* Effect.promise(() => listenerClosed(redirect));
            expect(yield* client['auth.status']({})).toStrictEqual({
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
  }
);

testStable(
  'duplicate finish rejects while the admitted sign-in still awaits its callback',
  async () => {
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
            assert.ok(
              failureKind(
                yield* Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
              ) === 'invalid_input'
            );
            const redirect = callback(attempt.url);
            const alive = yield* Effect.promise(() => fetch(new URL('/unknown', redirect)));

            assert.strictEqual(alive.status, 404);
            yield* Effect.promise(() => alive.arrayBuffer());
            redirect.searchParams.set('error', 'access_denied');
            const response = yield* Effect.promise(() => fetch(redirect));

            assert.strictEqual(response.status, 400);
            yield* Effect.promise(() => response.text());
            assert.ok(yield* Fiber.join(first));
            yield* Effect.promise(() => listenerClosed(redirect));
            assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
          })
        )
      );
    } finally {
      await f.close();
    }
  }
);

testStable('cancel rejects a pending finish and cannot leave credentials behind', async () => {
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
          assert.strictEqual(
            yield* client['auth.cancelSignIn']({ attemptId: attempt.attemptId }),
            true
          );
          assert.ok(failureKind(yield* Fiber.join(pending)) === 'cancelled');
          assert.strictEqual(
            yield* client['auth.cancelSignIn']({ attemptId: attempt.attemptId }),
            false
          );
          yield* Effect.promise(() => listenerClosed(callback(attempt.url)));
        })
      )
    );
    await f.reopen();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });

          assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
        })
      )
    );
  } finally {
    await f.close();
  }
});

testStable('interrupting an HTTP finish closes its callback listener', async () => {
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
          assert.ok(
            failureKind(
              yield* Effect.flip(client['auth.finishSignIn']({ attemptId: attempt.attemptId }))
            ) === 'invalid_input'
          );
          const redirect = callback(attempt.url);
          let onClose!: () => void;
          const closed = new Promise<void>((resolve) => {
            onClose = resolve;
          });
          const socket = yield* Effect.promise(() =>
            Bun.connect({
              hostname: redirect.hostname,
              port: Number(redirect.port),
              socket: {
                data() {},
                close() {
                  onClose();
                }
              }
            })
          );

          yield* Fiber.interrupt(pending);
          yield* Effect.promise(() => waitForClose(closed));
          socket.end();
          yield* Effect.promise(() => listenerClosed(redirect));
          assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
        })
      )
    );
    await f.reopen();
  } finally {
    await f.close();
  }
});

testStable('stale attempt IDs cannot finish or cancel a replacement sign-in', async () => {
  const f = await fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
          const old = yield* client['auth.startSignIn']({});
          const current = yield* client['auth.startSignIn']({ reconsent: true });

          assert.notStrictEqual(current.attemptId, old.attemptId);
          assert.ok(new URL(current.url).searchParams.get('force_reconsent') === 'true');
          yield* Effect.promise(() => listenerClosed(callback(old.url)));
          assert.ok(
            failureKind(
              yield* Effect.flip(client['auth.finishSignIn']({ attemptId: old.attemptId }))
            ) === 'invalid_input'
          );
          assert.strictEqual(
            yield* client['auth.cancelSignIn']({ attemptId: old.attemptId }),
            false
          );
          const alive = yield* Effect.promise(() =>
            fetch(new URL('/unknown', callback(current.url)))
          );

          assert.strictEqual(alive.status, 404);
          yield* Effect.promise(() => alive.arrayBuffer());
          assert.strictEqual(
            yield* client['auth.cancelSignIn']({ attemptId: current.attemptId }),
            true
          );
          yield* Effect.promise(() => listenerClosed(callback(current.url)));
          assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
        })
      )
    );
  } finally {
    await f.close();
  }
});

testStable('a mismatched callback state rejects sign-in without saving an account', async () => {
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

          assert.strictEqual(response.status, 400);
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

          assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
        })
      )
    );
  } finally {
    await f.close();
  }
});

testStable(
  'sign-out cancels admission and preserves default and saved preferences across reopen',
  async () => {
    const f = await fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            let client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });

            expect(yield* client['auth.status']({})).toStrictEqual({
              signedIn: false,
              email: null,
              sharing: false
            });
            const defaults = yield* client['settings.appSettings']({});

            expect(defaults).toStrictEqual({
              language: Language.ENGLISH,
              appearance: Appearance.DARK,
              zoomPercent: 100,
              onboarded: false
            });
            const llm = yield* client['settings.llmSettings']({});

            for (const tier of [llm.tiny, llm.medium, llm.smart]) {
              assert.strictEqual(tier?.provider, LlmProvider.CHAT_GPT);
              assert.strictEqual(tier?.model, undefined);
            }

            assert.strictEqual((yield* client['settings.reviewSettings']({})).newCardsPerDay, 20);
            assert.ok((yield* client['settings.materialSettings']({})).sift === true);
            yield* client['auth.signOut']({});
            yield* Effect.promise(() => f.reopen());
            client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
            expect(yield* client['settings.appSettings']({})).toStrictEqual(defaults);
            expect(yield* client['settings.llmSettings']({})).toStrictEqual(llm);
            assert.strictEqual((yield* client['settings.reviewSettings']({})).newCardsPerDay, 20);
            assert.ok((yield* client['settings.materialSettings']({})).sift === true);
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
            assert.ok(failureKind(yield* Fiber.join(pending)) === 'cancelled');
            yield* Effect.promise(() => listenerClosed(callback(attempt.url)));
            yield* Effect.promise(() => f.reopen());
            client = yield* makeStudyClient(StudyRpc, { baseUrl: f.url });
            assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
            assert.strictEqual(
              (yield* client['projects.projects']({ limit: 20 })).items[0]?.id,
              project.id
            );
            expect(yield* client['settings.appSettings']({})).toStrictEqual(saved);
            assert.strictEqual((yield* client['settings.reviewSettings']({})).newCardsPerDay, 35);
            assert.ok((yield* client['settings.materialSettings']({})).sift === false);
          })
        )
      );
    } finally {
      await f.close();
    }
  }
);

testStable('application shutdown closes an unfinished sign-in callback', async () => {
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

testStable('ChatGPT host identity is valid, distinct, and survives server restart', async () => {
  const first = await fixture();
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

  try {
    hostId = await start(first.url);
    expect(hostId).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(await start(first.url)).toBe(hostId);
    await first.reopen();
    expect(await start(first.url)).toBe(hostId);
  } finally {
    await first.close();
  }

  const second = await fixture();

  try {
    expect(await start(second.url)).not.toBe(hostId);
  } finally {
    await second.close();
  }
});
