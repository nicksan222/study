import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem, Schedule } from 'effect';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

type Cleanup = () => unknown | Promise<unknown>;

type Managed = { close(): void | Promise<void> };

type TestResources = {
  defer(cleanup: Cleanup): void;
  manage<T extends Managed>(resource: T): T;
  acquire<T extends Managed>(create: () => Promise<T>): Promise<T>;
  move(): TestResources;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
};

/** Preserve synchronous close behavior and retry a failed deliberate early close at teardown. */
function ownClose<T extends Managed>(resource: T): T {
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

  return resource;
}

/** LIFO fixture ownership, including partial setup failures and deliberate early closes. */
export function createTestResources(stack = new AsyncDisposableStack()): TestResources {
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= stack.disposeAsync().finally(() => {
      closing = undefined;
    }));

  return {
    defer: (cleanup: Cleanup) =>
      stack.defer(async () => {
        await cleanup();
      }),
    manage<T extends Managed>(resource: T): T {
      const owned = ownClose(resource);

      stack.defer(() => owned.close());

      return owned;
    },
    async acquire<T extends Managed>(create: () => Promise<T>): Promise<T> {
      if (stack.disposed) throw new ReferenceError('Test resources are disposed');

      const pending = Promise.resolve().then(create).then(ownClose);
      const outcome = pending.catch(() => undefined);

      stack.defer(async () => {
        const resource = await outcome;

        await resource?.close();
      });
      const resource = await pending;

      if (stack.disposed)
        throw new ReferenceError('Test resources were disposed during acquisition');

      return resource;
    },
    close,
    move: () => createTestResources(stack.move()),
    [Symbol.asyncDispose]: close
  };
}

/** Scoped fixture storage; executable files avoid Linux CI's noexec SQLite TMPDIR. */
export async function temporaryDirectory(
  options: {
    executable?: boolean;
    directory?: string;
    prefix?: string;
    waitForWindowsHandles?: boolean;
  } = {}
) {
  if (options.directory)
    await Effect.runPromise(fs.makeDirectory(options.directory, { recursive: true }));

  const path = await Effect.runPromise(
    fs.makeTempDirectory({
      prefix: options.prefix ?? 'study-test-',
      directory:
        options.directory ??
        (options.executable && process.platform === 'linux' ? '/tmp' : undefined)
    })
  );

  const remove = fs.remove(path, { recursive: true, force: true });
  // WebView2 can release profile files after the owning application has exited.
  const cleanup =
    options.waitForWindowsHandles && process.platform === 'win32'
      ? remove.pipe(
          Effect.retry({
            schedule: Schedule.spaced('100 millis'),
            times: 30,
            while: (error) => error.reason._tag === 'Busy'
          })
        )
      : remove;

  return { path, [Symbol.asyncDispose]: () => Effect.runPromise(cleanup) };
}
