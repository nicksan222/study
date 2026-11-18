function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });

  return { promise, resolve };
}

async function wait(gate: Promise<void>, signal: AbortSignal | undefined, aborted: () => void) {
  if (!signal) return gate;

  let reject!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_resolve, no) => {
    reject = no;
  });
  const abort = () => {
    aborted();
    reject(signal.reason);
  };

  signal.addEventListener('abort', abort, { once: true });

  try {
    if (signal.aborted) abort();

    await Promise.race([gate, interrupted]);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** Synchronizes an injected asynchronous boundary on invocation, release and cooperative cancellation. */
export function createControlledOperation<Input, Output>(
  perform: (input: Input) => Output | Promise<Output>,
  options: { readonly hold?: boolean; readonly onSettled?: () => void } = {}
) {
  const called = deferred<Input>();
  const aborted = deferred<void>();
  const gate = deferred<void>();

  if (!options.hold) gate.resolve();

  return {
    called: called.promise,
    aborted: aborted.promise,
    release: () => gate.resolve(),
    async run(input: Input, signal?: AbortSignal): Promise<Output> {
      called.resolve(input);
      let interrupted = false;

      try {
        await wait(gate.promise, signal, () => {
          interrupted = true;
        });

        if (signal?.aborted) {
          interrupted = true;
          signal.throwIfAborted();
        }

        return await perform(input);
      } finally {
        try {
          options.onSettled?.();
        } finally {
          if (interrupted) aborted.resolve();
        }
      }
    }
  };
}
