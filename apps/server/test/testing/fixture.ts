/** Runner-independent fixtures compose real SQLite, application and HTTP RPC resources. */
import { Db } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { createTestResources } from '@study/testing/resources';

import type { App } from '#server/runtime/service';

import type { test as serverTestApi } from './scenarios.ts';
import type { createStudyMaterials as makeStudyMaterials } from './study-materials.ts';

/** Acquire once, register immediately, and close consumers before deleting their database. */
export async function createServerFixture() {
  await using setup = createTestResources();
  const database = await createTestDatabase();

  setup.defer(() => database.cleanup());
  const resources = setup.move();

  const openApp = async (
    options: Omit<Parameters<(typeof App)['open']>[0], 'path'> & { path?: string } = {}
  ) => {
    const { App } = await import('#server/runtime/service');

    return resources.acquire(async () =>
      App.open({ ...options, path: options.path ?? (await database.prepare()) })
    );
  };

  return {
    dir: database.dir,
    path: database.path,
    dispose: resources.defer,
    manage: resources.manage,
    openApp,
    openDb: async (path?: string) =>
      resources.acquire(async () => {
        const db = path ? await Db.open(path) : await database.open();

        if (path) return db;

        try {
          const { initializeDatabaseInfrastructure } = await import('#server/runtime/database');

          await initializeDatabaseInfrastructure(db);

          return db;
        } catch (error) {
          db.close();

          throw error;
        }
      }),
    async openRpc(options?: Parameters<typeof openApp>[0]) {
      const app = await openApp(options);
      const { serve } = await import('#server/runtime/server');
      const server = await resources.acquire(() => serve(app));

      return { app, server };
    },
    close: resources.close,
    [Symbol.asyncDispose]: resources[Symbol.asyncDispose]
  };
}

/** A real HTTP endpoint whose reopen operation preserves the same owned database. */
export async function createRpcFixture() {
  await using setup = createTestResources();
  const location = setup.manage(await createServerFixture());
  let endpoint = await location.openRpc();
  const owner = setup.move();

  return {
    location,
    get app() {
      return endpoint.app;
    },
    get server() {
      return endpoint.server;
    },
    get url() {
      return endpoint.server.url;
    },
    async reopen() {
      await endpoint.server.close();
      await endpoint.app.close();
      endpoint = await location.openRpc();
    },
    close: owner.close,
    [Symbol.asyncDispose]: owner[Symbol.asyncDispose]
  };
}

/** Type-only bridge for runner configurations; loading a fixture never imports a runner. */
export type ServerTestApi = typeof serverTestApi;

/** Load feature-backed seed helpers only when a browser test requests study data. */
export async function createStudyMaterials(...args: Parameters<typeof makeStudyMaterials>) {
  const { createStudyMaterials } = await import('./study-materials.ts');

  return createStudyMaterials(...args);
}

export { createVoiceMock } from './voice.ts';
export { speechRecognitionStrategies } from '#server/features/voice/service/strategy';
