import type { TestContext } from 'node:test';

import { Db } from '@study/db';

import { App } from '#server/runtime/service';

import { manageResource, stateFor } from './automatic.ts';
import type { TestState } from './automatic.ts';

type Cleanup = () => void | Promise<void>;

type Managed = { close(): void | Promise<void> };

type TestResources = {
  dir: string;
  path: string;
  dispose: (fn: Cleanup) => void;
  manage: <T extends Managed>(resource: T) => T;
  openApp: (
    options?: Omit<Parameters<typeof App.open>[0], 'path'> & { path?: string }
  ) => Promise<App>;
  openDb: (path?: string) => Db;
};

export type ServerTest = TestResources & {
  app: App;
  store: App['store'];
  wake: () => void;
  run: App['nativeRuntime']['runPromise'];
};

export type ServerTestOptions = { app: false };

const opened = new WeakMap<TestState, Promise<ServerTest>>();

function resources(state: TestState): TestResources {
  return {
    dir: state.database.dir,
    path: state.database.path,
    dispose: (fn) => state.resources.push(fn),
    manage: (resource) => manageResource(state, resource),
    openApp: async (options = {}) =>
      manageResource(
        state,
        await App.open({ ...options, path: options.path ?? state.database.path })
      ),
    openDb: (path = state.database.path) => manageResource(state, Db.open(path))
  };
}

export function createServerTest(t: TestContext, options: ServerTestOptions): TestResources;

export function createServerTest(t: TestContext): Promise<ServerTest>;

export function createServerTest(
  t: TestContext,
  options?: ServerTestOptions
): Promise<ServerTest> | TestResources {
  const state = stateFor(t);
  const resource = resources(state);

  if (options?.app === false) return resource;

  let fixture = opened.get(state);

  if (!fixture) {
    fixture = resource.openApp().then((app) => ({
      ...resource,
      app,
      store: app.store,
      wake: () => app.workers.wake(),
      run: app.nativeRuntime.runPromise.bind(app.nativeRuntime)
    }));
    opened.set(state, fixture);
  }

  return fixture;
}

export const createStudyTest = createServerTest;
