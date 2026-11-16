import { sql } from '@study/db';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises OAuth completion and refresh races, ensuring public-safe account         │
 * │ persistence, restoration after persistence failure, and cancellation that aborts the     │
 * │ HTTP request and closes the listener.                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses a local HTTP peer to control OAuth token, refresh, and interruption races.        │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { preferences } from '@study/db';
import type { Db } from '@study/db';
import { test } from '@study/testing';
import type { Context } from 'effect';
import { Effect, Fiber, Layer } from 'effect';

import { Auth } from '#server/features/auth/index';
import { AuthManager } from '#server/platform/ai/auth/index';
import type { Account, AccessSeed } from '#server/platform/ai/auth/index';
import { ChatGptSession } from '#server/platform/ai/auth/service';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

async function peer({ assert: assertions }: Pick<test.server.Context, 'assert'>) {
  const assert: test.Assert = assertions;

  let nonce = '';
  let issuer = '';
  let refreshStarted!: () => void;
  let releaseRefresh!: () => void;
  const refreshRequest = new Promise<void>((resolve) => {
    refreshStarted = resolve;
  });
  const refreshRelease = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let rotate = false;
  let blockToken = false;
  let tokenStarted!: () => void;
  let tokenClosed!: () => void;
  const tokenRequest = new Promise<void>((resolve) => {
    tokenStarted = resolve;
  });
  const tokenAbort = new Promise<void>((resolve) => {
    tokenClosed = resolve;
  });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const body = await request.text();

      const form = new URLSearchParams(body);

      assert.ok(new URL(request.url).pathname === '/api/accounts/oauth/token');

      if (form.get('grant_type') === 'refresh_token') {
        if (rotate) {
          refreshStarted();
          await refreshRelease;

          return Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-secret' });
        } else return new Response(null, { status: 400 });
      }

      assert.ok(form.get('grant_type') === 'authorization_code');

      if (blockToken) {
        request.signal.addEventListener('abort', tokenClosed, { once: true });
        tokenStarted();

        return new Promise<Response>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(new Response(null)), {
            once: true
          })
        );
      }

      const claims = {
        iss: issuer,
        aud: 'client',
        sub: 'person',
        nonce,
        exp: Date.now() / 1000 + 3600,
        email: 'p@example.test'
      };
      const idToken = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

      return Response.json({
        id_token: idToken,
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        expires_in: 3600,
        scope: 'chatgpt.tokens.use.direct'
      });
    }
  });

  assert.ok(server.port);
  issuer = server.url.origin;

  return {
    issuer,
    blockToken() {
      blockToken = true;
    },
    tokenRequest,
    tokenAbort,
    startRotation() {
      rotate = true;
    },
    refreshRequest,
    releaseRefresh,
    callback(url: string) {
      const authorization = new URL(url);

      nonce = authorization.searchParams.get('nonce')!;
      const redirect = new URL(authorization.searchParams.get('redirect_uri')!);

      redirect.searchParams.set('state', authorization.searchParams.get('state')!);
      redirect.searchParams.set('code', 'authorization-code');
      redirect.searchParams.set('client_id', 'client');

      return redirect;
    },
    close: () => server.stop(true)
  };
}

type Databases = () => Promise<{ open(): Promise<Db>; cleanup(): Promise<void> }>;

async function withAuth(
  { assert: assertions }: Pick<test.server.Context, 'assert'>,
  databases: Databases,
  run: (
    layer: Layer.Layer<Database | Context.Service.Identifier<typeof Auth>, unknown, never>,
    context: ServerContext,
    oauth: Awaited<ReturnType<typeof peer>>,
    manager: AuthManager
  ) => Promise<void>
) {
  const assert: test.Assert = assertions;

  const oauth = await peer({ assert });
  const location = await databases();
  const context = new ServerContext(await location.open());
  const manager = new AuthManager({ issuer: oauth.issuer, saveRefresh: async () => {} });
  const layer = Auth.layer.pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.succeed(Database, { store: context }),
        Layer.succeed(ChatGptSession, { manager, issuer: oauth.issuer, hostId: 'test' })
      )
    )
  );

  try {
    await run(layer, context, oauth, manager);
  } finally {
    await manager.dispose();
    context.close();
    await location.cleanup();
    await oauth.close();
  }
}

test.server.stable(
  'successful OAuth finish persists only a public-safe account and changes generation on repeated sign-in',
  async ({ databases, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    await withAuth({ assert }, databases, async (layer, context, oauth) => {
      function* verifyRepeatedSignIn({
        assert: assertions,
        expect
      }: Pick<test.server.Context, 'assert' | 'expect'>) {
        const assert: test.Assert = assertions;

        const auth = yield* Auth;
        const initial = yield* auth.credentialGeneration();
        const attempt = yield* auth.startSignIn({});
        const pending = yield* Effect.forkChild(
          auth.finishSignIn({ attemptId: attempt.attemptId })
        );
        const response = yield* Effect.promise(() => fetch(oauth.callback(attempt.url)));

        assert.strictEqual(response.status, 200);
        yield* Effect.promise(() => response.text());
        expect(yield* Fiber.join(pending)).toStrictEqual({
          signedIn: true,
          email: 'p@example.test',
          sharing: true
        });
        expect(yield* auth.publicAccount()).toStrictEqual({
          subject: 'person',
          email: 'p@example.test',
          sharing: true
        });
        const first = yield* auth.credentialGeneration();

        expect(first).not.toStrictEqual(initial);
        const second = yield* auth.startSignIn({});
        const finishing = yield* Effect.forkChild(
          auth.finishSignIn({ attemptId: second.attemptId })
        );
        const result = yield* Effect.promise(() => fetch(oauth.callback(second.url)));

        yield* Effect.promise(() => result.text());
        yield* Fiber.join(finishing);
        expect(yield* auth.credentialGeneration()).not.toStrictEqual(first);
        const rows = context.db.orm.select().from(preferences).all();
        const account = rows.find((row) => row.key === 'account');

        assert.ok(JSON.parse(account!.value).refreshToken === 'refresh-secret');
        assert.ok(!JSON.stringify(yield* auth.publicAccount()).includes('secret'));
      }

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(() => verifyRepeatedSignIn({ assert, expect })).pipe(Effect.provide(layer))
        )
      );
    });
  }
);

test.server.stable(
  'failed OAuth persistence restores the previous account and session',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    await withAuth({ assert }, databases, async (layer, context, oauth, manager) => {
      const previous = {
        subject: 'old',
        clientId: 'client',
        refreshToken: 'old-secret',
        sharing: true
      };

      context.db.orm
        .insert(preferences)
        .values({ scope: 'private.chatgpt', key: 'account', value: JSON.stringify(previous) })
        .run();

      function* verifyAccountRestoration({
        assert: assertions
      }: Pick<test.server.Context, 'assert'>) {
        const assert: test.Assert = assertions;

        const auth = yield* Auth;

        context.db.orm.run(
          sql`CREATE TRIGGER reject_auth_save BEFORE UPDATE ON preferences WHEN OLD.scope = 'private.chatgpt' AND OLD.key = 'account' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
        );
        const attempt = yield* auth.startSignIn({});
        const pending = yield* Effect.forkChild(
          Effect.flip(auth.finishSignIn({ attemptId: attempt.attemptId }))
        );
        const response = yield* Effect.promise(() => fetch(oauth.callback(attempt.url)));

        yield* Effect.promise(() => response.text());
        assert.ok(yield* Fiber.join(pending));
        assert.ok((yield* auth.publicAccount())?.subject === 'old');
        assert.ok(
          JSON.parse(
            context.db.orm
              .select()
              .from(preferences)
              .all()
              .find((row) => row.key === 'account')!.value
          ).refreshToken === 'old-secret'
        );
        // A restored session attempts refresh rather than reporting a signed-out session.
        const failure = yield* Effect.flip(
          Effect.tryPromise({ try: () => manager.token(), catch: (error) => error })
        );

        assert.ok(failure instanceof Error);
        assert.notStrictEqual(failure.message, 'ChatGPT is not signed in');
      }

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(() => verifyAccountRestoration({ assert })).pipe(Effect.provide(layer))
        )
      );
    });
  }
);

test.server.stable(
  'refresh rotation settling during OAuth finish survives the sign-in commit',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const oauth = await peer({ assert });

    oauth.startRotation();
    const location = await databases();
    const context = new ServerContext(await location.open());
    const previous = {
      subject: 'person',
      clientId: 'client',
      refreshToken: 'refresh-secret',
      sharing: true,
      email: 'p@example.test'
    };

    context.db.orm
      .insert(preferences)
      .values({ scope: 'private.chatgpt', key: 'account', value: JSON.stringify(previous) })
      .run();
    let saveRefresh: (account: typeof previous, token: string) => Promise<void> = async () => {
      throw new Error('not initialized');
    };
    let replacementStarted!: () => void;
    const replacement = new Promise<void>((resolve) => {
      replacementStarted = resolve;
    });

    class ObservedAuthManager extends AuthManager {
      override replace(account: Account, seed?: AccessSeed) {
        if (seed) replacementStarted();

        return super.replace(account, seed);
      }
    }

    const manager = new ObservedAuthManager({
      issuer: oauth.issuer,
      saveRefresh: (account, token) => saveRefresh(account as typeof previous, token)
    });
    const layer = Auth.layer.pipe(
      Layer.provideMerge(
        Layer.merge(
          Layer.succeed(Database, { store: context }),
          Layer.succeed(ChatGptSession, { manager, issuer: oauth.issuer, hostId: 'test' })
        )
      )
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const auth = yield* Auth;

            saveRefresh = (account, token) =>
              Effect.runPromise(
                auth
                  .rotateRefreshToken({ previous: account, token })
                  .pipe(Effect.provideService(Database, { store: context }))
              );
            const refresh = manager.token().catch(() => undefined);

            yield* Effect.promise(() => oauth.refreshRequest);
            const attempt = yield* auth.startSignIn({});
            const finishing = yield* Effect.forkChild(
              auth.finishSignIn({ attemptId: attempt.attemptId })
            );
            const response = yield* Effect.promise(() => fetch(oauth.callback(attempt.url)));

            yield* Effect.promise(() => response.text());
            yield* Effect.promise(() => replacement);
            oauth.releaseRefresh();
            yield* Effect.promise(() => refresh);
            yield* Fiber.join(finishing);
            const row = context.db.orm
              .select()
              .from(preferences)
              .all()
              .find((entry) => entry.key === 'account');

            assert.ok(JSON.parse(row!.value).refreshToken === 'rotated-secret');
          }).pipe(Effect.provide(layer))
        )
      );
    } finally {
      oauth.releaseRefresh();
      await manager.dispose();
      context.close();
      await location.cleanup();
      await oauth.close();
    }
  }
);

test.server.stable(
  'interrupting finish aborts the token HTTP request and closes the listener',
  async ({ databases, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    await withAuth({ assert }, databases, async (layer, _context, oauth) => {
      oauth.blockToken();

      function* verifySignInInterruption({ expect }: Pick<test.server.Context, 'expect'>) {
        const auth = yield* Auth;
        const attempt = yield* auth.startSignIn({});
        const callback = oauth.callback(attempt.url);
        const finishing = yield* Effect.forkChild(
          auth.finishSignIn({ attemptId: attempt.attemptId })
        );
        const response = yield* Effect.promise(() => fetch(callback));

        yield* Effect.promise(() => response.text());
        yield* Effect.promise(() => oauth.tokenRequest);
        yield* Fiber.interrupt(finishing);
        yield* Effect.promise(() => oauth.tokenAbort);
        yield* Effect.promise(() => expect(fetch(callback)).rejects.toThrow());
      }

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(() => verifySignInInterruption({ expect })).pipe(Effect.provide(layer))
        )
      );
    });
  }
);
