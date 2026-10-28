import type { TestContext } from 'node:test';

import { createTestDatabase } from '@study/db/testing';

type Cleanup = () => void | Promise<void>;

export type TestState = {
  database: ReturnType<typeof createTestDatabase>;
  resources: Cleanup[];
};

const states = new WeakMap<TestContext, TestState>();

const databases: ReturnType<typeof createTestDatabase>[] = [];

export function registerTest(t: TestContext) {
  const database = createTestDatabase();
  const state: TestState = { database, resources: [] };

  databases.push(database);
  states.set(t, state);
  t.after(async () => {
    const errors: unknown[] = [];

    for (const cleanup of state.resources.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length) throw new AggregateError(errors, 'Test resource cleanup failed');
  });
}

export function cleanupTestFile() {
  const errors: unknown[] = [];

  for (const database of databases) {
    try {
      database.cleanup();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length) throw new AggregateError(errors, 'Test database cleanup failed');
}

export function stateFor(t: TestContext): TestState {
  const state = states.get(t);

  if (!state) throw new Error('Backend test preload is required');

  return state;
}

/** Register a real resource immediately and make deliberate early close safe. */
export function manageResource<T extends { close(): void | Promise<void> }>(
  state: TestState,
  resource: T
): T {
  const close = resource.close.bind(resource);
  let closed = false;
  let pending: Promise<void> | undefined;

  resource.close = (() => {
    if (closed) return;

    if (pending) return pending;

    const result = close();

    if (result) {
      pending = result.then(
        () => {
          closed = true;
          pending = undefined;
        },
        (error: unknown) => {
          pending = undefined;

          throw error;
        }
      );

      return pending;
    }

    closed = true;
  }) as T['close'];
  state.resources.push(() => resource.close());

  return resource;
}
