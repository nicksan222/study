import { StudyRpc } from '@study/contracts';
import { snapshotValues } from '@study/contracts/testing';
import { createTestDatabase } from '@study/db/testing';
import { createTestResources } from '@study/testing/resources';
import { createTestApi, test as baseTest } from '@study/testing/vitest';
import { Effect, Exit, Scope } from 'effect';

import { makeStudyClient } from '#server/client/index';

import { createRpcFixture, createServerFixture } from './fixture.ts';
import { inTestPhase } from './progress.ts';

const runner = baseTest.stable
  .extend('resources', async ({ task: _task }, { onCleanup }) => {
    const resources = await createServerFixture();

    onCleanup(() => inTestPhase(undefined, 'fixture-cleanup', () => resources.close()));

    return resources;
  })
  .extend('db', async ({ resources }) => resources.openDb())
  .extend('databases', async ({ task: _task }, { onCleanup }) => {
    const owner = createTestResources();

    onCleanup(() => owner.close());

    return async (migrationsFolder?: string) => {
      const database = await createTestDatabase(migrationsFolder);
      const owned = owner.manage({ close: database.cleanup });
      const db = await database.open();

      try {
        const { initializeDatabaseInfrastructure } = await import('#server/runtime/database');

        await initializeDatabaseInfrastructure(db);
      } finally {
        db.close();
      }

      return {
        dir: database.dir,
        path: database.path,
        prepare: database.prepare,
        open: database.open,
        cleanup: owned.close,
        [Symbol.asyncDispose]: owned.close
      };
    };
  })
  .extend('endpoints', async ({ task: _task }, { onCleanup }) => {
    const owner = createTestResources();

    onCleanup(() => owner.close());

    return () => owner.acquire(() => createRpcFixture());
  })
  .extend('server', async ({ resources }) => {
    let app = await resources.openApp();
    const run = () => app.nativeRuntime.runPromise.bind(app.nativeRuntime);

    return {
      ...resources,
      get app() {
        return app;
      },
      get store() {
        return app.store;
      },
      get path() {
        return resources.path;
      },
      get dir() {
        return resources.dir;
      },
      get fixture() {
        return resources;
      },
      wake: () => app.workers.wake(),
      get run() {
        return run();
      },
      get runPromise() {
        return run();
      },
      reopen: async () => {
        await app.close();
        app = await resources.openApp();
      }
    };
  })
  .extend('rpc', async ({ server, resources }, { onCleanup }) => {
    let clientScope = Scope.makeUnsafe();

    onCleanup(() => Effect.runPromise(Scope.close(clientScope, Exit.void)));

    const { serve } = await import('#server/runtime/server');
    let endpoint = resources.manage(await serve(server.app));
    let client = await Effect.runPromise(
      Scope.provide(makeStudyClient(StudyRpc, { baseUrl: () => endpoint.url }), clientScope)
    );

    const close = async () => {
      const closing = createTestResources();

      closing.defer(() => endpoint.close());
      closing.defer(() => Effect.runPromise(Scope.close(clientScope, Exit.void)));
      await closing.close();
    };

    return {
      get app() {
        return server.app;
      },
      get server() {
        return endpoint;
      },
      get url() {
        return endpoint.url;
      },
      get client() {
        return client;
      },
      runPromise: <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
        Effect.runPromise(Scope.provide(effect, clientScope)),
      close,
      reopen: async () => {
        await close();
        await server.reopen();
        endpoint = resources.manage(await serve(server.app));
        clientScope = Scope.makeUnsafe();
        client = await Effect.runPromise(
          Scope.provide(makeStudyClient(StudyRpc, { baseUrl: () => endpoint.url }), clientScope)
        );
      },
      fixture: resources
    };
  })
  .extend('createServerFixture', { scope: 'worker' }, () => createServerFixture)
  .extend('createRpcFixture', { scope: 'worker' }, () => createRpcFixture)
  .extend('createTestDatabase', { scope: 'worker' }, () => createTestDatabase)
  .extend('snapshotValues', { scope: 'worker' }, () => snapshotValues);

/** One classified test API; fixtures are lazily acquired only when requested. */
export const test: ReturnType<typeof createTestApi<typeof runner>> = createTestApi(runner);
