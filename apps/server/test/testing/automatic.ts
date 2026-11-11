/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Owns per-test SQLite fixtures and LIFO cleanup resources for server tests. It      │
 * │ makes deliberate early closes safe and aggregates cleanup failures before removing       │
 * │ fixture files.                                                                           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - registerTest creates a database per TestContext; manageResource makes early close      │
 * │   idempotent and cleanupTestFile aggregates cleanup errors.                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Imported by preload.ts and server-test.ts; wraps @study/db/testing databases and Node    │
 * │ TestContext cleanup hooks.                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createTestDatabase } from '@study/db/testing';
import type { TestContext } from 'vite-plus/test';

import { inTestPhase } from './progress.ts';

type Cleanup = () => void | Promise<void>;

export type TestState = {
  database: Awaited<Awaited<ReturnType<typeof createTestDatabase>>>;
  resources: Cleanup[];
};

const states = new WeakMap<TestContext, TestState>();

const databases: Awaited<Awaited<ReturnType<typeof createTestDatabase>>>[] = [];

export async function registerTest(t: TestContext) {
  console.debug('study-test-phase:automatic-setup:start');

  const database = await createTestDatabase();
  const state: TestState = { database, resources: [] };

  databases.push(database);
  states.set(t, state);
  t.onTestFinished(() =>
    inTestPhase(t, 'automatic-cleanup', async () => {
      const errors: unknown[] = [];

      for (const [index, cleanup] of state.resources.reverse().entries()) {
        try {
          await inTestPhase(t, `automatic-resource-${index}`, cleanup);
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length) throw new AggregateError(errors, 'Test resource cleanup failed');
    })
  );
  console.debug('study-test-phase:automatic-setup:complete');
}

export async function cleanupTestFile() {
  const errors: unknown[] = [];

  for (const database of databases) {
    try {
      await database.cleanup();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length) throw new AggregateError(errors, 'Test database cleanup failed');
}

export function stateFor(t: TestContext): TestState {
  const state = states.get(t);

  if (!state) throw new Error('Server test preload is required');

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
