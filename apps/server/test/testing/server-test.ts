import type { TestContext } from 'node:test';

import { createProcedureContext } from '#server/runtime/procedure-context';
import type { ProcedureContext } from '#server/runtime/procedure-context';
import { appRouter } from '#server/runtime/router';
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
};

export type ServerTest = TestResources & {
  app: App;
  store: App['store'];
  context: ProcedureContext;
  caller: ReturnType<typeof appRouter.createCaller>;
  callerFor: (signal: AbortSignal) => ReturnType<typeof appRouter.createCaller>;
  wake: () => void;
};

export type ServerTestOptions = { app: false };

const opened = new WeakMap<TestState, Promise<ServerTest>>();

function resources(state: TestState): TestResources {
  return {
    dir: state.database.dir,
    path: state.database.path,
    dispose: (fn) => state.resources.push(fn),
    manage: (resource) => manageResource(state, resource)
  };
}

function openApp(state: TestState): Promise<ServerTest> {
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

export function createServerTest(t: TestContext, options: ServerTestOptions): TestResources;

export function createServerTest(t: TestContext): Promise<ServerTest>;

export function createServerTest(
  t: TestContext,
  options?: ServerTestOptions
): Promise<ServerTest> | TestResources {
  const state = stateFor(t);

  if (options?.app === false) return resources(state);

  let fixture = opened.get(state);

  if (!fixture) {
    fixture = openApp(state);
    opened.set(state, fixture);
  }

  return fixture;
}
