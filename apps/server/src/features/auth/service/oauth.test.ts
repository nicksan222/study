import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { sql } from '@study/db';
import { preferences } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import type { Context } from 'effect';
import { Effect, Fiber, Layer } from 'effect';

import { Auth } from '#server/features/auth/index';
import { AuthManager } from '#server/platform/ai/auth/index';
import type { Account, AccessSeed } from '#server/platform/ai/auth/index';
import { ChatGptSession } from '#server/platform/ai/auth/service';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

async function peer() {
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
  const server = createServer(async (request, response) => {
    let body = '';

    for await (const part of request) body += part;

    const form = new URLSearchParams(body);

    assert.equal(request.url, '/api/accounts/oauth/token');

    if (form.get('grant_type') === 'refresh_token') {
      if (rotate) {
        refreshStarted();
        await refreshRelease;
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ access_token: 'rotated-access', refresh_token: 'rotated-secret' }));
      } else response.writeHead(400).end();

      return;
    }

    assert.equal(form.get('grant_type'), 'authorization_code');

    if (blockToken) {
      response.on('close', tokenClosed);
      tokenStarted();

      return;
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

    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        id_token: idToken,
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        expires_in: 3600,
        scope: 'chatgpt.tokens.use.direct'
      })
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  assert.ok(address && typeof address !== 'string');
  issuer = `http://127.0.0.1:${address.port}`;

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
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}

async function withAuth(
  run: (
    layer: Layer.Layer<Context.Service.Identifier<typeof Auth>, unknown, never>,
    context: ServerContext,
    oauth: Awaited<ReturnType<typeof peer>>,
    manager: AuthManager
  ) => Promise<void>
) {
  const oauth = await peer();
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const manager = new AuthManager({ issuer: oauth.issuer, saveRefresh: async () => {} });
  const layer = Auth.layer.pipe(
    Layer.provide(
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
    location.cleanup();
    await oauth.close();
  }
}

test('successful OAuth finish persists only a public-safe account and changes generation on repeated sign-in', async () => {
  await withAuth(async (layer, context, oauth) => {
    function* verifyRepeatedSignIn() {
      const auth = yield* Auth;
      const initial = yield* auth.credentialGeneration();
      const attempt = yield* auth.startSignIn({});
      const pending = yield* Effect.forkChild(auth.finishSignIn({ attemptId: attempt.attemptId }));
      const response = yield* Effect.promise(() => fetch(oauth.callback(attempt.url)));

      assert.equal(response.status, 200);
      yield* Effect.promise(() => response.text());
      assert.deepEqual(yield* Fiber.join(pending), {
        signedIn: true,
        email: 'p@example.test',
        sharing: true
      });
      assert.deepEqual(yield* auth.publicAccount(), {
        subject: 'person',
        email: 'p@example.test',
        sharing: true
      });
      const first = yield* auth.credentialGeneration();

      assert.notDeepEqual(first, initial);
      const second = yield* auth.startSignIn({});
      const finishing = yield* Effect.forkChild(auth.finishSignIn({ attemptId: second.attemptId }));
      const result = yield* Effect.promise(() => fetch(oauth.callback(second.url)));

      yield* Effect.promise(() => result.text());
      yield* Fiber.join(finishing);
      assert.notDeepEqual(yield* auth.credentialGeneration(), first);
      const rows = context.db.orm.select().from(preferences).all();
      const account = rows.find((row) => row.key === 'account');

      assert.equal(JSON.parse(account!.value).refreshToken, 'refresh-secret');
      assert.ok(!JSON.stringify(yield* auth.publicAccount()).includes('secret'));
    }

    await Effect.runPromise(
      Effect.scoped(Effect.gen(verifyRepeatedSignIn).pipe(Effect.provide(layer)))
    );
  });
});

test('failed OAuth persistence restores the previous account and session', async () => {
  await withAuth(async (layer, context, oauth, manager) => {
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

    function* verifyAccountRestoration() {
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
      assert.equal((yield* auth.publicAccount())?.subject, 'old');
      assert.equal(
        JSON.parse(
          context.db.orm
            .select()
            .from(preferences)
            .all()
            .find((row) => row.key === 'account')!.value
        ).refreshToken,
        'old-secret'
      );
      // A restored session attempts refresh rather than reporting a signed-out session.
      const failure = yield* Effect.flip(
        Effect.tryPromise({ try: () => manager.token(), catch: (error) => error })
      );

      assert.ok(failure instanceof Error);
      assert.notEqual(failure.message, 'ChatGPT is not signed in');
    }

    await Effect.runPromise(
      Effect.scoped(Effect.gen(verifyAccountRestoration).pipe(Effect.provide(layer)))
    );
  });
});

test('refresh rotation settling during OAuth finish survives the sign-in commit', async () => {
  const oauth = await peer();

  oauth.startRotation();
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
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
    Layer.provide(
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
            Effect.runPromise(auth.rotateRefreshToken({ previous: account, token }));
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

          assert.equal(JSON.parse(row!.value).refreshToken, 'rotated-secret');
        }).pipe(Effect.provide(layer))
      )
    );
  } finally {
    oauth.releaseRefresh();
    await manager.dispose();
    context.close();
    location.cleanup();
    await oauth.close();
  }
});

test('interrupting finish aborts the token HTTP request and closes the listener', async () => {
  await withAuth(async (layer, _context, oauth) => {
    oauth.blockToken();

    function* verifySignInInterruption() {
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
      yield* Effect.promise(() => assert.rejects(fetch(callback)));
    }

    await Effect.runPromise(
      Effect.scoped(Effect.gen(verifySignInInterruption).pipe(Effect.provide(layer)))
    );
  });
});
