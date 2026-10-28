import type { TestContext } from 'node:test';

import { createProcedureContext } from '#backend/runtime/procedure-context';
import type { ProcedureContext } from '#backend/runtime/procedure-context';
import { appRouter } from '#backend/runtime/router';
import { App } from '#backend/runtime/service';

import { manageResource, stateFor } from './automatic.ts';
import type { TestState } from './automatic.ts';

type Cleanup = () => void | Promise<void>;

type Managed = { close(): void | Promise<void> };

type TestResources = {
  dir: string;
  path: string;
  dispose: (fn: Cleanup) => void;
  manage: <T extends Managed>(resource: T) => T;
};

export type BackendTest = TestResources & {
  app: App;
  store: App['store'];
  context: ProcedureContext;
  caller: ReturnType<typeof appRouter.createCaller>;
  callerFor: (signal: AbortSignal) => ReturnType<typeof appRouter.createCaller>;
  wake: () => void;
};

export type BackendTestOptions = { app: false };

const opened = new WeakMap<TestState, Promise<BackendTest>>();

function resources(state: TestState): TestResources {
  return {
    dir: state.database.dir,
    path: state.database.path,
    dispose: (fn) => state.resources.push(fn),
    manage: (resource) => manageResource(state, resource)
  };
}

function openApp(state: TestState): Promise<BackendTest> {
  const resource = resources(state);

  return App.open({ path: resource.path }).then((app) => {
    resource.manage(app);
    const context = createProcedureContext(app);

    return {
      ...resource,
      app,
      store: app.store,
      context,
      caller: appRouter.createCaller(context),
      callerFor: (signal) => appRouter.createCaller(context, { signal }),
      wake: () => app.workers.wake()
    };
  });
}

export function createBackendTest(t: TestContext, options: BackendTestOptions): TestResources;

export function createBackendTest(t: TestContext): Promise<BackendTest>;

export function createBackendTest(
  t: TestContext,
  options?: BackendTestOptions
): Promise<BackendTest> | TestResources {
  const state = stateFor(t);

  if (options?.app === false) return resources(state);

  let fixture = opened.get(state);

  if (!fixture) {
    fixture = openApp(state);
    opened.set(state, fixture);
  }

  return fixture;
}
