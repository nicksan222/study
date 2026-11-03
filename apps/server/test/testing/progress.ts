/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reports each test result and retains diagnostics only for failing test files.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps stdout, stderr and fixture phases available when a test file fails.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public Node test events; never inspects resources or logs operation payloads.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Readable } from 'node:stream';
import type { TestContext } from 'node:test';
import { spec } from 'node:test/reporters';
import type { TestEvent } from 'node:test/reporters';

/** Console events are file-scoped, so failure diagnostics retain the whole file's output. */
export default async function* progress(source: AsyncIterable<TestEvent>) {
  yield* Readable.from(observe(source)).pipe(new spec());
}

function isDiagnostic(event: TestEvent) {
  return (
    ['test:stdout', 'test:stderr', 'test:log'].includes(event.type) ||
    (event.type === 'test:diagnostic' && event.data.file !== undefined)
  );
}

/** Group imported test definitions with the process that owns their console output. */
function entryFile(data: TestEvent['data']) {
  if (!data) return undefined;

  return (
    ('entryFile' in data ? data.entryFile : undefined) ?? ('file' in data ? data.file : undefined)
  );
}

async function* observe(source: AsyncIterable<TestEvent>) {
  const pending = new Map<string | undefined, TestEvent[]>();
  const failed = new Set<string | undefined>();

  for await (const event of source) {
    const file = entryFile(event.data);

    if (event.type === 'test:fail') {
      failed.add(file);
      yield* pending.get(file) ?? [];
      pending.delete(file);
    }

    if (isDiagnostic(event)) {
      if (failed.has(file)) yield event;
      else {
        const events = pending.get(file) ?? [];

        events.push(event);
        pending.set(file, events);
      }
    } else yield event;

    if (event.type === 'test:summary') {
      pending.delete(file);
      failed.delete(file);
    }
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
