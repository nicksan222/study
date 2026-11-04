/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tracks named server test phases while preserving operation outcomes.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Emits phase diagnostics through captured Vitest console output.                        │
 * │ - Preserves operation results and original failures during cleanup.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests own resources; the runner filters diagnostics for successful test files.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { TestContext } from 'vite-plus/test';

/** Await the actual operation; diagnostics never race, cancel or detach owned cleanup. */
export async function inTestPhase<A>(
  _t: TestContext | undefined,
  phase: string,
  work: () => A | Promise<A>
): Promise<A> {
  const started = performance.now();

  console.debug(`study-test-phase:${phase}:start`);

  try {
    const result = await work();

    console.debug(
      `study-test-phase:${phase}:complete elapsedMs=${Math.round(performance.now() - started)}`
    );

    return result;
  } catch (cause) {
    console.debug(
      `study-test-phase:${phase}:failed elapsedMs=${Math.round(performance.now() - started)}`
    );

    throw cause;
  }
}
