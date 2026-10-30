import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sql } from '@study/db';

import { App } from '#server/runtime/service';
import { createServerTest } from '#testing/server-test';

test('application close is safe to call repeatedly', async (t) => {
  const resources = createServerTest(t, { app: false });
  const app = await resources.openApp();

  await app.close();
  await assert.doesNotReject(App.prototype.close.call(app));
});

test('worker stop and start are ordered, and application close rejects new starts', async (t) => {
  const resources = createServerTest(t, { app: false });
  const app = await resources.openApp();

  await app.workers.start();
  const stop = app.workers.stop();
  const restart = Promise.resolve(app.workers.start());

  await Promise.all([stop, restart]);
  assert.equal(app.workers.started, true);
  const closing = app.close();

  await assert.rejects(Promise.resolve().then(() => app.workers.start()));
  await closing;
});

test('a rejected second application open never acquires another database', async (t) => {
  const { existsSync } = await import('node:fs');
  const resources = createServerTest(t, { app: false });
  const app = await resources.openApp();
  const second = `${resources.path}.second`;

  assert.equal(existsSync(second), false);
  await assert.rejects(resources.openApp({ path: second }));
  assert.equal(existsSync(second), false);
  await app.close();
});

for (const failPersistence of [false, true])
  test(`shutdown ${failPersistence ? 'can retry' : 'persists'} an in-flight credential rotation before releasing Auth and SQLite`, async (t) => {
    const { createServer } = await import('node:http');
    const { Effect, Option } = await import('effect');
    const { AuthStore } = await import('#server/features/auth/store/index');
    const { ChatGptSession } = await import('#server/platform/ai/auth/service');
    const { decodeAccount, encodeAccount } = await import('#server/platform/ai/auth/index');
    const { ServerContext } = await import('#server/platform/database/context');
    const { transaction } = await import('#server/platform/definitions/define-store');
    let entered!: () => void;
    let release!: () => void;
    const requested = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const peer = createServer(async (request, response) => {
      for await (const _part of request) {
        /* Drain the real OAuth request. */
      }

      entered();
      await gate;
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(
          JSON.stringify({ access_token: 'access', refresh_token: 'rotated', expires_in: 3600 })
        );
    });

    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
    const address = peer.address();

    if (!address || typeof address === 'string') throw new Error('OAuth listener missing');

    const resources = createServerTest(t, { app: false });
    const context = new ServerContext(resources.openDb());

    await Effect.runPromise(
      transaction(context, (tx) =>
        tx.store(AuthStore).saveAccount(
          encodeAccount({
            subject: 'user',
            clientId: 'client',
            refreshToken: 'original',
            sharing: true
          })
        )
      )
    );
    context.close();
    const options = { path: resources.path, issuer: `http://127.0.0.1:${address.port}` };
    let app = await resources.openApp(options);

    try {
      const { manager } = await app.nativeRuntime.runPromise(ChatGptSession);

      if (failPersistence)
        app.store.db.orm.run(
          sql`CREATE TEMP TRIGGER fail_credential_save BEFORE UPDATE OF value ON preferences WHEN NEW.scope='private.chatgpt' AND NEW.key='account' BEGIN SELECT RAISE(ABORT,'credential storage unavailable'); END`
        );

      const token = manager.token().catch((error: unknown) => error);

      await requested;
      const closing = app.close();

      for (let turn = 0; turn < 10; turn++) await Promise.resolve();

      release();
      await token;

      if (failPersistence) {
        await assert.rejects(closing);
        const retained = await app.nativeRuntime.runPromise(
          AuthStore.make(app.store).findAccount(undefined)
        );

        assert.ok(Option.isSome(retained));
        assert.equal(decodeAccount(retained.value).refreshToken, 'original');
        app.store.db.orm.run(sql`DROP TRIGGER fail_credential_save`);
        await app.close();
      } else await closing;

      app = await resources.openApp(options);
      const account = await app.nativeRuntime.runPromise(
        AuthStore.make(app.store).findAccount(undefined)
      );

      assert.ok(Option.isSome(account));
      assert.equal(decodeAccount(account.value).refreshToken, 'rotated');
    } finally {
      release();

      try {
        await app.close();
      } finally {
        await new Promise<void>((resolve) => peer.close(() => resolve()));
      }
    }
  });

test('failed database acquisition releases the process-wide auth owner', async (t) => {
  const resources = createServerTest(t, { app: false });

  await assert.rejects(resources.openApp({ path: `${resources.dir}/missing/database.sqlite` }));
  const app = await resources.openApp();

  await app.close();
});
