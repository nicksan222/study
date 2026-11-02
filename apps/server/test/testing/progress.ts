/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Adds execution-ordered test progress alongside the standard Node TAP results.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reports test execution and named fixture phases before declaration-ordered results.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public Node test events; never inspects resources or logs operation payloads.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { TestContext } from 'node:test';
import { tap } from 'node:test/reporters';
import type { TestEvent } from 'node:test/reporters';

/** Preserve TAP while exposing execution events across both concurrent test files. */
export default async function* progress(source: AsyncIterable<TestEvent>) {
  yield* tap(observe(source));
}

async function* observe(source: AsyncIterable<TestEvent>) {
  for await (const event of source) {
    if (
      event.type === 'test:dequeue' ||
      event.type === 'test:complete' ||
      (event.type === 'test:log' && event.data.message.startsWith('study-test-phase:'))
    ) {
      const { file, entryFile, name, testId, nesting } = event.data;

      process.stderr.write(
        JSON.stringify({
          event: event.type,
          at: new Date().toISOString(),
          file,
          entryFile,
          name,
          testId,
          nesting,
          phase: event.type === 'test:log' ? event.data.message : undefined,
          passed: event.type === 'test:complete' ? event.data.details.passed : undefined
        }) + '\n'
      );
    }

    yield event;
  }
}

/** Await the actual operation; diagnostics never race, cancel or detach owned cleanup. */
export async function inTestPhase<A>(
  t: TestContext | undefined,
  phase: string,
  work: () => A | Promise<A>
): Promise<A> {
  t?.log(`study-test-phase:${phase}:start`);

  try {
    const result = await work();

    t?.log(`study-test-phase:${phase}:complete`);

    return result;
  } catch (cause) {
    t?.log(`study-test-phase:${phase}:failed`);

    throw cause;
  }
}
