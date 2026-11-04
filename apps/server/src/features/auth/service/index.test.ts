/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Covers private account persistence, atomic refresh rotation, concurrent sign-in    │
 * │ rejection, listener cleanup on cancel or scope close, and rollback when sign-out         │
 * │ persistence fails.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses a test database and managed auth session to assert rollback and cleanup behavior. │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sql } from '@study/db';
import { preferences } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Fiber, Layer } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Auth } from '#server/features/auth/index';
import { AuthManager, SignIn } from '#server/platform/ai/auth/index';
import { ChatGptSession } from '#server/platform/ai/auth/service';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

testStable('auth uses private SQLite account and guards refresh rotation', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const manager = new AuthManager({ issuer: 'http://localhost', saveRefresh: async () => {} });
  const layer = Auth.layer.pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.succeed(Database, { store: context }),
        Layer.succeed(ChatGptSession, { manager, issuer: 'http://localhost', hostId: 'test' })
      )
    )
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const auth = yield* Auth;

          expect(yield* auth.status()).toStrictEqual({
            signedIn: false,
            email: null,
            sharing: false
          });
          assert.strictEqual(yield* auth.publicAccount(), undefined);
          const account = {
            subject: 'person',
            clientId: 'client',
            refreshToken: 'secret',
            sharing: true
          };

          assert.ok(
            yield* Effect.flip(auth.rotateRefreshToken({ previous: account, token: 'new' }))
          );
          const first = yield* auth.startSignIn({});

          assert.strictEqual(yield* auth.cancelSignIn({ attemptId: 'stale' }), false);
          assert.strictEqual(yield* auth.cancelSignIn({ attemptId: first.attemptId }), true);
          assert.ok(
            (yield* Effect.flip(auth.finishSignIn({ attemptId: first.attemptId }))).kind ===
              'invalid_input'
          );
        }).pipe(Effect.provide(layer))
      )
    );
  } finally {
    await manager.dispose();
    context.close();
    location.cleanup();
  }
});

testStable('persisted account is public-safe and refresh rotation is atomic', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const account = {
    subject: 'person',
    clientId: 'client',
    refreshToken: 'secret',
    sharing: true,
    email: 'p@example.test'
  };

  context.db.orm
    .insert(preferences)
    .values({ scope: 'private.chatgpt', key: 'account', value: JSON.stringify(account) })
    .run();
  const manager = new AuthManager({ issuer: 'http://localhost', saveRefresh: async () => {} });
  const layer = Auth.layer.pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.succeed(Database, { store: context }),
        Layer.succeed(ChatGptSession, { manager, issuer: 'http://localhost', hostId: 'test' })
      )
    )
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const auth = yield* Auth;

          expect(yield* auth.publicAccount()).toStrictEqual({
            subject: 'person',
            email: 'p@example.test',
            sharing: true
          });
          yield* auth.rotateRefreshToken({ previous: account, token: 'rotated' });
          yield* auth.rotateRefreshToken({ previous: account, token: 'rotated' });
          assert.ok(
            yield* Effect.flip(auth.rotateRefreshToken({ previous: account, token: 'other' }))
          );
          const row = context.db.orm.select().from(preferences).get();

          assert.ok(JSON.parse(row!.value).refreshToken === 'rotated');
          yield* auth.signOut();
          assert.ok((yield* auth.status()).signedIn === false);
        }).pipe(Effect.provide(layer))
      )
    );
  } finally {
    await manager.dispose();
    context.close();
    location.cleanup();
  }
});

testStable('concurrent finish rejects and cancelling closes the real listener', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const manager = new AuthManager({ issuer: 'http://localhost', saveRefresh: async () => {} });
  const layer = Auth.layer.pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.succeed(Database, { store: context }),
        Layer.succeed(ChatGptSession, { manager, issuer: 'http://localhost', hostId: 'test' })
      )
    )
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const auth = yield* Auth;
          const attempt = yield* auth.startSignIn({});
          const callback = new URL(new URL(attempt.url).searchParams.get('redirect_uri')!);
          const pending = yield* Effect.forkChild(
            auth.finishSignIn({ attemptId: attempt.attemptId })
          );

          yield* Effect.yieldNow;
          assert.ok(
            (yield* Effect.flip(auth.finishSignIn({ attemptId: attempt.attemptId }))).kind ===
              'invalid_input'
          );
          assert.strictEqual(yield* auth.cancelSignIn({ attemptId: attempt.attemptId }), true);
          yield* Fiber.await(pending);
          yield* Effect.promise(async () => {
            await expect(fetch(callback)).rejects.toSatisfy(() => true);
          });
        }).pipe(Effect.provide(layer))
      )
    );
  } finally {
    await manager.dispose();
    context.close();
    location.cleanup();
  }
});

testStable('failed sign-out persistence restores the account and session', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const account = { subject: 'person', clientId: 'client', refreshToken: 'secret', sharing: true };

  context.db.orm
    .insert(preferences)
    .values({ scope: 'private.chatgpt', key: 'account', value: JSON.stringify(account) })
    .run();
  const manager = new AuthManager({ issuer: 'http://localhost', saveRefresh: async () => {} });
  const layer = Auth.layer.pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.succeed(Database, { store: context }),
        Layer.succeed(ChatGptSession, { manager, issuer: 'http://localhost', hostId: 'test' })
      )
    )
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const auth = yield* Auth;

          context.db.orm.run(
            sql`CREATE TRIGGER reject_auth_delete BEFORE DELETE ON preferences WHEN OLD.scope = 'private.chatgpt' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
          );
          assert.ok(yield* Effect.flip(auth.signOut()));
          assert.ok((yield* auth.status()).signedIn === true);
          assert.ok(
            JSON.parse(context.db.orm.select().from(preferences).get()!.value).refreshToken ===
              'secret'
          );
        }).pipe(Effect.provide(layer))
      )
    );
  } finally {
    await manager.dispose();
    context.close();
    location.cleanup();
  }
});

testStable('closing the service scope closes an unfinished listener', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const manager = new AuthManager({ issuer: 'http://localhost', saveRefresh: async () => {} });
  const layer = Auth.layer.pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.succeed(Database, { store: context }),
        Layer.succeed(ChatGptSession, { manager, issuer: 'http://localhost', hostId: 'test' })
      )
    )
  );

  try {
    const url = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const auth = yield* Auth;
          const attempt = yield* auth.startSignIn({});

          return new URL(new URL(attempt.url).searchParams.get('redirect_uri')!);
        }).pipe(Effect.provide(layer))
      )
    );

    await expect(fetch(url)).rejects.toSatisfy(() => true);
  } finally {
    await manager.dispose();
    context.close();
    location.cleanup();
  }
});

testStable('cancelling during listener acquisition releases the acquired listener', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const manager = new AuthManager({ issuer: 'http://localhost', saveRefresh: async () => {} });
  const layer = Auth.layer.pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.succeed(Database, { store: context }),
        Layer.succeed(ChatGptSession, { manager, issuer: 'http://localhost', hostId: 'test' })
      )
    )
  );
  const original = SignIn.start;
  let release!: () => void;
  let acquired!: (url: string) => void;
  const ready = new Promise<string>((resolve) => {
    acquired = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  SignIn.start = async (options) => {
    const signin = await original(options);

    acquired(signin.url);
    await gate;

    return signin;
  };

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const auth = yield* Auth;
          const starting = yield* Effect.forkChild(auth.startSignIn({}));
          const url = yield* Effect.promise(() => ready);
          const callback = new URL(new URL(url).searchParams.get('redirect_uri')!);

          yield* auth.cancelSignIn({});
          release();
          yield* Fiber.await(starting);
          yield* Effect.promise(() => expect(fetch(callback)).rejects.toSatisfy(() => true));
        }).pipe(Effect.provide(layer))
      )
    );
  } finally {
    release();
    SignIn.start = original;
    await manager.dispose();
    context.close();
    location.cleanup();
  }
});
